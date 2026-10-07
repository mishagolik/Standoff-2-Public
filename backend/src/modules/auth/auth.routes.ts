import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma'
import { redis } from '../../db/redis'

const guestSchema = z.object({
  username: z.string().min(3).max(20),
  gameId: z.string().trim().min(1).max(64),
  website: z.string().max(200).optional()
})

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/auth/guest - create a browser-held profile using game identity only
  app.post('/guest', async (req, reply) => {
    const body = guestSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.website?.trim()) return reply.status(400).send({ error: 'Profile request rejected' })

    const rate = await redis.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return { count, redis.call('TTL', KEYS[1]) }",
      1,
      `auth:guest:ip:${req.ip}`,
      3600
    ) as number[]
    if (rate[0] > 5) {
      reply.header('Retry-After', Math.max(rate[1], 1))
      return reply.status(429).send({ error: 'Too many profiles created from this network. Try again later.' })
    }

    const { username, gameId } = body.data
    const exists = await prisma.user.findFirst({
      where: { OR: [{ username }, { gameId }] },
      select: { id: true }
    })
    if (exists) return reply.status(409).send({ error: 'Nickname or Standoff 2 ID already registered' })

    let user
    try {
      user = await prisma.user.create({
        data: { username, gameId },
        select: { id: true, username: true, gameId: true, elo: true, wins: true, losses: true }
      })
    } catch (error: any) {
      if (error.code === 'P2002') return reply.status(409).send({ error: 'Nickname or Standoff 2 ID already registered' })
      throw error
    }

    const token = app.jwt.sign({ id: user.id, username: user.username }, { expiresIn: '365d' })
    return reply.status(201).send({ user, token })
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req) => {
    const { id } = (req as any).user
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, gameId: true, elo: true, wins: true, losses: true, points: true, createdAt: true }
    })
    return user
  })
}
