import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 100, 3000)
})

redis.on('error', (err) => console.error('Redis error:', err))
redis.on('connect', () => console.log('✅ Redis connected'))

// Keys helpers
export const KEYS = {
  queue5v5: 'matchmaking:queue:5v5',
  queue2v2: 'matchmaking:queue:2v2',
  userSocket: (userId: string) => `socket:user:${userId}`,
  lobbyPlayers: (matchId: string) => `lobby:${matchId}:players`,
  lobbyReady: (matchId: string) => `lobby:${matchId}:ready`
}
