import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma'
import { processMatchElo } from '../elo/elo.service'
import { io } from '../../index'

const resultSchema = z.object({
  teamAScore: z.number().int().min(0),
  teamBScore: z.number().int().min(0),
  playerStats: z.array(z.object({
    userId: z.string(),
    kills: z.number().int().min(0),
    deaths: z.number().int().min(0)
  }))
})

const vetoSchema = z.object({ map: z.string() })

const MAPS = ['Breeze', 'Dune', 'Province', 'Rust', 'Sandstone']

export const matchRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [(app as any).authenticate] }

  // GET /api/matches/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        players: { include: { user: { select: { id: true, username: true, elo: true, gameId: true } } } },
        vetoBans: { orderBy: { order: 'asc' } }
      }
    })
    if (!match) return reply.status(404).send({ error: 'Match not found' })
    return match
  })

  // GET /api/matches - list with filters
  app.get('/', async (req) => {
    const { status, mode, limit = '20', offset = '0' } = req.query as any
    const matches = await prisma.match.findMany({
      where: {
        status: status || undefined,
        mode: mode || undefined
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit), 50),
      skip: Number(offset),
      include: {
        players: { select: { team: true, user: { select: { username: true, elo: true } } } }
      }
    })
    return matches
  })

  // POST /api/matches/:id/veto - captain bans a map
  app.post('/:id/veto', auth, async (req, reply) => {
    const { id } = req.params as any
    const body = vetoSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const { id: userId } = (req as any).user
    const { map } = body.data

    const match = await prisma.match.findUnique({
      where: { id },
      include: { players: true, vetoBans: true }
    })
    if (!match) return reply.status(404).send({ error: 'Match not found' })
    if (match.status !== 'VETO') return reply.status(400).send({ error: 'Not in veto phase' })

    const player = match.players.find(p => p.userId === userId && p.isCaptain)
    if (!player) return reply.status(403).send({ error: 'Not a captain' })

    const bansCount = match.vetoBans.length
    // Alternating teams: even bans = TEAM_A, odd = TEAM_B
    const expectedTeam = bansCount % 2 === 0 ? 'TEAM_A' : 'TEAM_B'
    if (player.team !== expectedTeam) return reply.status(400).send({ error: 'Not your turn to ban' })

    if (match.vetoBans.find(v => v.map === map)) return reply.status(400).send({ error: 'Map already banned' })
    if (!MAPS.includes(map)) return reply.status(400).send({ error: 'Invalid map' })

    await prisma.vetoBan.create({ data: { matchId: id, map, bannedBy: player.team, order: bansCount } })

    const remaining = MAPS.filter(m => !match.vetoBans.map(v => v.map).includes(m) && m !== map)

    // After 4 bans (5 maps - 4 = 1 left), pick remaining map and start match
    if (bansCount + 1 >= 4) {
      const pickedMap = remaining[0]
      await prisma.match.update({
        where: { id },
        data: { status: 'IN_PROGRESS', map: pickedMap, startedAt: new Date() }
      })
      io.to(`match:${id}`).emit('match:started', { map: pickedMap })
    } else {
      io.to(`match:${id}`).emit('match:veto', { banned: map, by: player.team, remaining })
    }

    return { banned: map, remaining }
  })

  // POST /api/matches/:id/result - submit match result
  app.post('/:id/result', auth, async (req, reply) => {
    const { id } = req.params as any
    const body = resultSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const match = await prisma.match.findUnique({ where: { id }, include: { players: true } })
    if (!match) return reply.status(404).send({ error: 'Match not found' })
    if (match.status !== 'IN_PROGRESS') return reply.status(400).send({ error: 'Match not in progress' })

    const { teamAScore, teamBScore, playerStats } = body.data
    const winningSide = teamAScore > teamBScore ? 'TEAM_A' : 'TEAM_B'

    // Update player stats
    await Promise.all(playerStats.map(stat =>
      prisma.matchPlayer.updateMany({
        where: { matchId: id, userId: stat.userId },
        data: { kills: stat.kills, deaths: stat.deaths }
      })
    ))

    await prisma.match.update({
      where: { id },
      data: { status: 'COMPLETED', teamAScore, teamBScore, winningSide, endedAt: new Date() }
    })

    // Calculate ELO changes
    await processMatchElo(id, match.mode, winningSide)

    // Notify players
    io.to(`match:${id}`).emit('match:ended', { winningSide, teamAScore, teamBScore })

    return { winningSide, teamAScore, teamBScore }
  })
}
