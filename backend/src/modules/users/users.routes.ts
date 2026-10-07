import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma'

const updateSchema = z.object({
  username: z.string().min(3).max(20).optional(),
  gameId: z.string().optional()
})

export const userRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [(app as any).authenticate] }

  // GET /api/users/leaderboard
  app.get('/leaderboard', async (req) => {
    const { limit = '50', offset = '0' } = req.query as any
    const users = await prisma.user.findMany({
      orderBy: { elo: 'desc' },
      take: Math.min(Number(limit), 100),
      skip: Number(offset),
      select: { id: true, username: true, elo: true, wins: true, losses: true }
    })
    return users.map((u, i) => ({ ...u, rank: Number(offset) + i + 1 }))
  })

  // GET /api/users/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, elo: true, wins: true, losses: true,
        points: true, createdAt: true,
        eloHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
        matchPlayers: {
          orderBy: { match: { createdAt: 'desc' } },
          take: 10,
          include: { match: { select: { id: true, mode: true, map: true, status: true, createdAt: true, winningSide: true } } }
        }
      }
    })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const winRate = user.wins + user.losses > 0
      ? Math.round((user.wins / (user.wins + user.losses)) * 100)
      : 0

    return { ...user, winRate }
  })

  // PATCH /api/users/me
  app.patch('/me', auth, async (req, reply) => {
    const { id } = (req as any).user
    const body = updateSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    if (body.data.username) {
      const taken = await prisma.user.findFirst({ where: { username: body.data.username, NOT: { id } } })
      if (taken) return reply.status(409).send({ error: 'Username taken' })
    }

    const user = await prisma.user.update({
      where: { id },
      data: body.data,
      select: { id: true, username: true, gameId: true, elo: true }
    })
    return user
  })
}
