import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { Server as SocketServer } from 'socket.io'
import { prisma } from './db/prisma'
import { redis } from './db/redis'
import { authRoutes } from './modules/auth/auth.routes'
import { userRoutes } from './modules/users/users.routes'
import { matchRoutes } from './modules/matches/matches.routes'
import { matchmakingRoutes } from './modules/matchmaking/matchmaking.routes'
import { forumRoutes } from './modules/forum/forum.routes'
import { startMatchmakingLoop } from './modules/matchmaking/matchmaking.service'
import { tournamentRoutes } from './modules/tournaments/tournaments.routes'
import { missionRoutes } from './modules/missions/missions.routes'
import { setupSocket } from './socket/socket'

const app = Fastify({ logger: true, trustProxy: 1, bodyLimit: 32 * 1024 })
const allowedOrigins = process.env.FRONTEND_URL?.split(',').map(origin => origin.trim()) || true

export const io = new SocketServer(app.server, {
  cors: { origin: allowedOrigins, credentials: true }
})

async function bootstrap() {
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'change-me-in-production'
  })

  // Auth decorator
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  // Routes
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(userRoutes, { prefix: '/api/users' })
  await app.register(matchRoutes, { prefix: '/api/matches' })
  await app.register(matchmakingRoutes, { prefix: '/api/matchmaking' })
  await app.register(forumRoutes, { prefix: '/api/forum' })
  await app.register(tournamentRoutes, { prefix: '/api/tournaments' })
  await app.register(missionRoutes, { prefix: '/api/missions' })

  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }))

  // Socket.io
  setupSocket(io)

  const PORT = Number(process.env.PORT) || 4000
  await app.listen({ port: PORT, host: '0.0.0.0' })
  startMatchmakingLoop()
  console.log(`🚀 Server running on http://localhost:${PORT}`)
}

bootstrap().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  await redis.quit()
  process.exit(1)
})
