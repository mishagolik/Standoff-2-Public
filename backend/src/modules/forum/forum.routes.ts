import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../db/prisma'
import { redis } from '../../db/redis'

const postSchema = z.object({
  title: z.string().trim().min(4).max(100),
  message: z.string().trim().min(10).max(1200),
  website: z.string().max(200).optional()
})

const chatMessageSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  website: z.string().max(200).optional()
})

const rateLimitScript = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return { count, redis.call('TTL', KEYS[1]) }
`

async function enforceRateLimit(reply: any, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const result = await redis.eval(rateLimitScript, 1, key, windowSeconds) as number[]
  const [count, ttl] = result
  if (count <= limit) return true

  reply.header('Retry-After', Math.max(ttl, 1))
  reply.status(429).send({ error: 'Too many forum requests. Please wait before trying again.' })
  return false
}

export const forumRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [(app as any).authenticate] }

  app.get('/', auth, async (req, reply) => {
    const user = (req as any).user as { id: string }
    if (!await enforceRateLimit(reply, `forum:read:ip:${req.ip}`, 90, 60)) return

    return prisma.forumPost.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, username: true, gameId: true } },
        _count: { select: { messages: true } }
      }
    }).then(posts => posts.map(post => ({ ...post, isMine: post.userId === user.id })))
  })

  app.get('/:postId/messages', auth, async (req, reply) => {
    const { postId } = req.params as { postId: string }
    if (!await enforceRateLimit(reply, `forum:chat-read:ip:${req.ip}`, 120, 60)) return

    const post = await prisma.forumPost.findUnique({ where: { id: postId }, select: { id: true } })
    if (!post) return reply.status(404).send({ error: 'Forum ad not found.' })

    return prisma.forumMessage.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { id: true, username: true, gameId: true } } }
    })
  })

  app.post('/:postId/messages', auth, async (req, reply) => {
    const { id: userId } = (req as any).user as { id: string }
    const { postId } = req.params as { postId: string }
    const body = chatMessageSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.website?.trim()) return reply.status(400).send({ error: 'Message rejected' })

    if (!await enforceRateLimit(reply, `forum:chat-write:ip:${req.ip}`, 12, 60)) return
    if (!await enforceRateLimit(reply, `forum:chat-write:user:${userId}`, 8, 60)) return

    const post = await prisma.forumPost.findUnique({ where: { id: postId }, select: { id: true } })
    if (!post) return reply.status(404).send({ error: 'Forum ad not found.' })

    return reply.status(201).send(await prisma.forumMessage.create({
      data: { postId, userId, message: body.data.message },
      include: { user: { select: { id: true, username: true, gameId: true } } }
    }))
  })

  app.post('/', auth, async (req, reply) => {
    const user = (req as any).user as { id: string }
    const body = postSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.website?.trim()) return reply.status(400).send({ error: 'Post rejected' })

    if (!await enforceRateLimit(reply, `forum:write:ip:${req.ip}`, 8, 60)) return
    if (!await enforceRateLimit(reply, `forum:write:user:${user.id}`, 2, 60)) return

    try {
      return reply.status(201).send(await prisma.forumPost.create({
        data: { userId: user.id, title: body.data.title, message: body.data.message },
        include: {
          user: { select: { id: true, username: true, gameId: true } },
          _count: { select: { messages: true } }
        }
      }))
    } catch (error: any) {
      if (error.code === 'P2002') {
        return reply.status(409).send({ error: 'You already have an ad. Edit or delete your current post first.' })
      }
      throw error
    }
  })

  app.put('/mine', auth, async (req, reply) => {
    const user = (req as any).user as { id: string }
    const body = postSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    if (body.data.website?.trim()) return reply.status(400).send({ error: 'Post rejected' })

    if (!await enforceRateLimit(reply, `forum:edit:ip:${req.ip}`, 12, 60)) return
    if (!await enforceRateLimit(reply, `forum:edit:user:${user.id}`, 5, 60)) return

    const post = await prisma.forumPost.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!post) return reply.status(404).send({ error: 'You do not have a post to edit.' })

    return prisma.forumPost.update({
      where: { userId: user.id },
      data: { title: body.data.title, message: body.data.message },
      include: {
        user: { select: { id: true, username: true, gameId: true } },
        _count: { select: { messages: true } }
      }
    })
  })

  app.delete('/mine', auth, async (req, reply) => {
    const user = (req as any).user as { id: string }
    if (!await enforceRateLimit(reply, `forum:delete:ip:${req.ip}`, 6, 60)) return

    const deleted = await prisma.forumPost.deleteMany({ where: { userId: user.id } })
    if (deleted.count === 0) return reply.status(404).send({ error: 'You do not have a post to delete.' })
    return { deleted: true }
  })
}
