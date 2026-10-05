import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma'

const createSchema = z.object({
  title: z.string().min(3).max(60),
  description: z.string().optional(),
  maxPlayers: z.number().int().min(4).max(64).default(16),
  prizePool: z.string().optional(),
  startsAt: z.string().datetime()
})

export const tournamentRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [(app as any).authenticate] }

  // GET /api/tournaments
  app.get('/', async (req) => {
    const { status } = req.query as any
    return prisma.tournament.findMany({
      where: { status: status || undefined },
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { players: true } } }
    })
  })

  // GET /api/tournaments/:id
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as any
    const t = await prisma.tournament.findUnique({
      where: { id },
      include: {
        players: { include: { user: { select: { id: true, username: true, elo: true } } } },
        rounds: { orderBy: { roundNumber: 'asc' } }
      }
    })
    if (!t) return reply.status(404).send({ error: 'Tournament not found' })
    return t
  })

  // POST /api/tournaments - create (admin only, simplified)
  app.post('/', auth, async (req, reply) => {
    const body = createSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const tournament = await prisma.tournament.create({
      data: { ...body.data, startsAt: new Date(body.data.startsAt), status: 'REGISTRATION' }
    })
    return reply.status(201).send(tournament)
  })

  // POST /api/tournaments/:id/register
  app.post('/:id/register', auth, async (req, reply) => {
    const { id } = req.params as any
    const { id: userId } = (req as any).user

    const tournament = await prisma.tournament.findUnique({
      where: { id },
      include: { _count: { select: { players: true } } }
    })
    if (!tournament) return reply.status(404).send({ error: 'Not found' })
    if (tournament.status !== 'REGISTRATION') return reply.status(400).send({ error: 'Registration closed' })
    if (tournament._count.players >= tournament.maxPlayers) return reply.status(400).send({ error: 'Tournament full' })

    const already = await prisma.tournamentPlayer.findUnique({ where: { tournamentId_userId: { tournamentId: id, userId } } })
    if (already) return reply.status(409).send({ error: 'Already registered' })

    await prisma.tournamentPlayer.create({ data: { tournamentId: id, userId } })
    return { message: 'Registered successfully' }
  })

  // DELETE /api/tournaments/:id/register - unregister
  app.delete('/:id/register', auth, async (req, reply) => {
    const { id } = req.params as any
    const { id: userId } = (req as any).user
    await prisma.tournamentPlayer.deleteMany({ where: { tournamentId: id, userId } })
    return { message: 'Unregistered' }
  })
}
