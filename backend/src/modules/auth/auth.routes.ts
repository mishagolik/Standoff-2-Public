import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../../db/prisma'
import { sendVerificationEmail, sendPasswordResetEmail } from './email.service'

// In-memory or Redis verification code storage (expires after 15 min)
const verificationCodes = new Map<string, { code: string; expiresAt: number; data?: any }>()

const sendCodeSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(20).optional()
})

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  username: z.string().min(3).max(20),
  password: z.string().min(6),
  gameId: z.string().optional()
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
})

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/auth/send-code - generate 6 digit code and send via Resend
  app.post('/send-code', async (req, reply) => {
    const body = sendCodeSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const { email, username = 'Agent' } = body.data

    // Check if email already registered
    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists) return reply.status(409).send({ error: 'Email already registered' })

    // Generate 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = Date.now() + 15 * 60 * 1000 // 15 mins

    verificationCodes.set(email.toLowerCase(), { code, expiresAt })

    await sendVerificationEmail(email, code, username)

    return reply.status(200).send({ message: 'Verification code sent to email' })
  })

  // POST /api/auth/verify-and-register - check 6-digit code and create user
  app.post('/verify-and-register', async (req, reply) => {
    const body = verifyCodeSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const { email, code, username, password, gameId } = body.data
    const record = verificationCodes.get(email.toLowerCase())

    if (!record || record.code !== code) {
      return reply.status(400).send({ error: 'Invalid verification code' })
    }

    if (Date.now() > record.expiresAt) {
      verificationCodes.delete(email.toLowerCase())
      return reply.status(400).send({ error: 'Verification code expired' })
    }

    // Code is valid -> Create user
    verificationCodes.delete(email.toLowerCase())

    const exists = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] }
    })
    if (exists) return reply.status(409).send({ error: 'Username or email already taken' })

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { username, email, passwordHash, gameId },
      select: { id: true, username: true, email: true, gameId: true, elo: true, createdAt: true }
    })

    const token = app.jwt.sign({ id: user.id, username: user.username }, { expiresIn: '7d' })
    return reply.status(201).send({ user, token })
  })

  // POST /api/auth/login
  app.post('/login', async (req, reply) => {
    const body = loginSchema.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const { email, password } = body.data

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ id: user.id, username: user.username }, { expiresIn: '7d' })
    return {
      user: { id: user.id, username: user.username, email: user.email, gameId: user.gameId, elo: user.elo },
      token
    }
  })

  // GET /api/auth/me
  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req) => {
    const { id } = (req as any).user
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, email: true, gameId: true, elo: true, wins: true, losses: true, points: true, createdAt: true }
    })
    return user
  })
}
