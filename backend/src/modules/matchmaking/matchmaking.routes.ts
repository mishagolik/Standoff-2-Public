import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { joinQueue, leaveQueue, getQueuePosition, getCurrentMatch } from './matchmaking.service'

const schema = z.object({ mode: z.enum(['FIVE_VS_FIVE', 'TWO_VS_TWO']) })

export const matchmakingRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [(app as any).authenticate] }

  // POST /api/matchmaking/join
  app.post('/join', auth, async (req, reply) => {
    const body = schema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const { id } = (req as any).user
    try {
      await joinQueue(id, body.data.mode)
      return { message: 'Joined queue', mode: body.data.mode }
    } catch (e: any) {
      return reply.status(400).send({ error: e.message })
    }
  })

  // POST /api/matchmaking/leave
  app.post('/leave', auth, async (req, reply) => {
    const body = schema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })
    const { id } = (req as any).user
    await leaveQueue(id, body.data.mode)
    return { message: 'Left queue' }
  })

  // GET /api/matchmaking/position?mode=FIVE_VS_FIVE
  app.get('/position', auth, async (req, reply) => {
    const { mode } = req.query as any
    if (!mode) return reply.status(400).send({ error: 'mode required' })
    const { id } = (req as any).user
    const position = await getQueuePosition(id, mode)
    return { position, inQueue: position > 0 }
  })

  app.get('/current', auth, async (req) => {
    const { id } = (req as any).user
    const match = await getCurrentMatch(id)
    return { match }
  })
}
