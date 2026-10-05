import { Server, Socket } from 'socket.io'
import { redis, KEYS } from '../db/redis'

interface AuthPayload {
  id: string
  username: string
}

export function setupSocket(io: Server) {
  // Socket auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token
    if (!token) return next(new Error('No token'))
    try {
      // Decode JWT token payload
      const base64Payload = token.split('.')[1]
      if (base64Payload) {
        const payload = JSON.parse(Buffer.from(base64Payload, 'base64').toString()) as AuthPayload
        ;(socket as any).user = payload
      } else {
        ;(socket as any).user = { id: 'guest', username: 'Player' }
      }
      next()
    } catch {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', async (socket: Socket) => {
    const user = (socket as any).user as AuthPayload
    console.log(`🔌 ${user.username} connected`)

    // Join personal room for notifications
    socket.join(`user:${user.id}`)
    await redis.set(KEYS.userSocket(user.id), socket.id, 'EX', 3600)

    // Join a match room
    socket.on('match:join', async (matchId: string) => {
      socket.join(`match:${matchId}`)
      socket.to(`match:${matchId}`).emit('match:player_joined', { userId: user.id, username: user.username })
    })

    socket.on('match:leave', (matchId: string) => {
      socket.leave(`match:${matchId}`)
    })

    // Chat in match lobby
    socket.on('match:chat', ({ matchId, message }: { matchId: string; message: string }) => {
      if (!message || message.length > 200) return
      io.to(`match:${matchId}`).emit('match:chat', {
        userId: user.id,
        username: user.username,
        message: message.trim(),
        time: new Date().toISOString()
      })
    })

    // Player ready confirmation
    socket.on('match:ready', async (matchId: string) => {
      const key = KEYS.lobbyReady(matchId)
      await redis.sadd(key, user.id)
      await redis.expire(key, 300)

      const readyCount = await redis.scard(key)
      const playerCount = await redis.scard(KEYS.lobbyPlayers(matchId))

      io.to(`match:${matchId}`).emit('match:ready_update', {
        userId: user.id,
        readyCount,
        playerCount
      })
    })

    // Queue position updates
    socket.on('queue:ping', async ({ mode }: { mode: string }) => {
      const key = mode === 'FIVE_VS_FIVE' ? KEYS.queue5v5 : KEYS.queue2v2
      const queueSize = await redis.zcard(key)
      socket.emit('queue:update', { queueSize, mode })
    })

    socket.on('disconnect', async () => {
      await redis.del(KEYS.userSocket(user.id))
      console.log(`❌ ${user.username} disconnected`)
    })
  })
}
