import { redis, KEYS } from '../../db/redis'
import { prisma } from '../../db/prisma'
import { io } from '../../index'
import { MatchMode } from '@prisma/client'

const MAPS = ['Breeze', 'Dune', 'Province', 'Rust', 'Sandstone']
const TEAM_SIZE = { FIVE_VS_FIVE: 5, TWO_VS_TWO: 2 }
const ELO_RANGE_START = 200
const ELO_RANGE_STEP = 100  // expand range every 30s
const SEARCH_TIMEOUT = 300   // seconds

interface QueueEntry {
  userId: string
  elo: number
  username: string
  joinedAt: number
}

export async function joinQueue(userId: string, mode: MatchMode): Promise<void> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2

  // Check not already in queue
  const existing = await redis.zscore(key, userId)
  if (existing) throw new Error('Already in queue')

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { elo: true, username: true } })
  if (!user) throw new Error('User not found')

  const entry: QueueEntry = { userId, elo: user.elo, username: user.username, joinedAt: Date.now() }
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

async function tryFormMatch(mode: MatchMode): Promise<void> {
  const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
  const needed = TEAM_SIZE[mode] * 2

  // Get all players sorted by ELO
  const allIds = await redis.zrange(key, 0, -1, 'WITHSCORES')
  if (allIds.length < needed * 2) return // not enough (id + score pairs)

  const players: QueueEntry[] = []
  for (let i = 0; i < allIds.length; i += 2) {
    const raw = await redis.get(`queue:entry:${allIds[i]}`)
    if (raw) players.push(JSON.parse(raw))
  }

  // Find a balanced group within ELO range
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
    include: { players: { include: { user: { select: { id: true, username: true, elo: true } } } } }
  })

  // Remove from queue
  await Promise.all(players.map(p => {
    redis.zrem(key, p.userId)
    redis.del(`queue:entry:${p.userId}`)
  }))

  // Notify all players via socket
  players.forEach(p => {
    io.to(`user:${p.userId}`).emit('match:found', {
      matchId: match.id,
      mode,
      map,
      players: match.players
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
