import { redis, KEYS } from '../../db/redis'
import { prisma } from '../../db/prisma'
import { io } from '../../index'
import { MatchMode } from '@prisma/client'
import { randomUUID } from 'crypto'

const MAPS = ['Breeze', 'Dune', 'Province', 'Rust', 'Sandstone']
const TEAM_SIZE = { FIVE_VS_FIVE: 5, TWO_VS_TWO: 2 }
const ELO_RANGE_START = 200
const ELO_RANGE_STEP = 100  // expand range every 30s
const SEARCH_TIMEOUT = 300   // seconds

interface QueueEntry {
  userId: string
  elo: number
  username: string
  gameId: string
  joinedAt: number
}

export async function joinQueue(userId: string, mode: MatchMode): Promise<void> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
  const otherKey = mode === 'FIVE_VS_FIVE' ? KEYS.queue2v2 : KEYS.queue5v5

  // Check not already in queue
  const existing = await redis.zscore(key, userId)
  if (existing !== null) throw new Error('Already in queue')
  const queuedElsewhere = await redis.zscore(otherKey, userId)
  if (queuedElsewhere !== null) throw new Error('Already in another matchmaking queue')

  const activeMatch = await prisma.matchPlayer.findFirst({
    where: { userId, match: { status: { in: ['VETO', 'IN_PROGRESS'] } } },
    select: { id: true }
  })
  if (activeMatch) throw new Error('Already in an active match')

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { elo: true, username: true, gameId: true } })
  if (!user) throw new Error('User not found')
  if (!user.gameId) throw new Error('Add your Standoff 2 game ID before joining matchmaking')

  const entry: QueueEntry = { userId, elo: user.elo, username: user.username, gameId: user.gameId, joinedAt: Date.now() }
  await redis.zadd(key, user.elo, userId)
  await redis.setex(`queue:entry:${userId}`, SEARCH_TIMEOUT, JSON.stringify(entry))

  // Try to form a match
  await tryFormMatch(mode)
}

export async function leaveQueue(userId: string, mode: MatchMode): Promise<void> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
  await redis.zrem(key, userId)
  await redis.del(`queue:entry:${userId}`)
}

export async function getQueuePosition(userId: string, mode: MatchMode): Promise<number> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
  const rank = await redis.zrank(key, userId)
  return rank !== null ? rank + 1 : -1
}

export async function getCurrentMatch(userId: string) {
  return prisma.match.findFirst({
    where: {
      status: { in: ['VETO', 'IN_PROGRESS'] },
      players: { some: { userId } }
    },
    orderBy: { createdAt: 'desc' },
    include: {
      players: { include: { user: { select: { id: true, username: true, elo: true, gameId: true } } } },
      vetoBans: { orderBy: { order: 'asc' } }
    }
  })
}

async function tryFormMatch(mode: MatchMode): Promise<void> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
  const lockKey = `matchmaking:lock:${mode}`
  const lockToken = randomUUID()
  const acquired = await redis.set(lockKey, lockToken, 'EX', 30, 'NX')
  if (acquired !== 'OK') return

  try {
    const needed = TEAM_SIZE[mode] * 2
    const allIds = await redis.zrange(key, 0, -1, 'WITHSCORES')
    if (allIds.length < needed * 2) return

    const players: QueueEntry[] = []
    for (let i = 0; i < allIds.length; i += 2) {
      const raw = await redis.get(`queue:entry:${allIds[i]}`)
      if (raw) players.push(JSON.parse(raw))
      else await redis.zrem(key, allIds[i])
    }

    for (let i = 0; i <= players.length - needed; i++) {
      const group = players.slice(i, i + needed)
      const eloRange = group[group.length - 1].elo - group[0].elo
      const waitTime = (Date.now() - Math.min(...group.map(p => p.joinedAt))) / 1000
      const allowedRange = ELO_RANGE_START + Math.floor(waitTime / 30) * ELO_RANGE_STEP

      if (eloRange <= allowedRange) {
        await createMatch(group, mode)
        return
      }
    }
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey,
      lockToken
    )
  }
}

async function createMatch(players: QueueEntry[], mode: MatchMode): Promise<void> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
  const map = MAPS[Math.floor(Math.random() * MAPS.length)]
  const perTeam = TEAM_SIZE[mode]

  // Sort by ELO, snake-draft into teams for balance
  const sorted = [...players].sort((a, b) => b.elo - a.elo)
  const teamA: QueueEntry[] = []
  const teamB: QueueEntry[] = []
  sorted.forEach((p, i) => (i % 2 === 0 ? teamA : teamB).push(p))

  const match = await prisma.match.create({
    data: {
      mode,
      map,
      status: 'VETO',
      players: {
        create: [
          ...teamA.map((p, i) => ({ userId: p.userId, team: 'TEAM_A' as const, isCaptain: i === 0 })),
          ...teamB.map((p, i) => ({ userId: p.userId, team: 'TEAM_B' as const, isCaptain: i === 0 }))
        ]
      }
    },
    include: { players: { include: { user: { select: { id: true, username: true, elo: true, gameId: true } } } } }
  })
  const host = match.players.find(player => player.team === 'TEAM_A' && player.isCaptain)?.user

  // Remove from queue
  await Promise.all(players.map(async p => {
    await redis.zrem(key, p.userId)
    await redis.del(`queue:entry:${p.userId}`)
  }))

  // Notify all players via socket
  players.forEach(p => {
    io.to(`user:${p.userId}`).emit('match:found', {
      matchId: match.id,
      mode,
      map,
      players: match.players,
      host
    })
  })
}

// Run matchmaking loop every 5 seconds
export function startMatchmakingLoop() {
  setInterval(async () => {
    await tryFormMatch('FIVE_VS_FIVE')
    await tryFormMatch('TWO_VS_TWO')
  }, 5000)
}
