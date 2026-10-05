import { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../db/prisma'

export const missionRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [(app as any).authenticate] }

  // GET /api/missions - active missions with user progress
  app.get('/', auth, async (req) => {
    const { id: userId } = (req as any).user
    const now = new Date()

    const missions = await prisma.mission.findMany({
      where: { isActive: true, weekStart: { lte: now }, weekEnd: { gte: now } },
      include: {
        progress: { where: { userId } }
      }
    })

    return missions.map(m => ({
      ...m,
      userProgress: m.progress[0] || { current: 0, completed: false, claimedAt: null },
      progress: undefined
    }))
  })

  // POST /api/missions/:id/claim - claim reward
  app.post('/:id/claim', auth, async (req, reply) => {
    const { id: missionId } = req.params as any
    const { id: userId } = (req as any).user

    const progress = await prisma.missionProgress.findUnique({
      where: { userId_missionId: { userId, missionId } },
      include: { mission: true }
    })

    if (!progress) return reply.status(404).send({ error: 'No progress found' })
    if (!progress.completed) return reply.status(400).send({ error: 'Mission not completed' })
    if (progress.claimedAt) return reply.status(400).send({ error: 'Already claimed' })

    await prisma.$transaction([
      prisma.missionProgress.update({
        where: { userId_missionId: { userId, missionId } },
        data: { claimedAt: new Date() }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { points: { increment: progress.mission.reward } }
      })
    ])

    return { message: 'Reward claimed', points: progress.mission.reward }
  })
}

// Called after each match to update mission progress
export async function updateMissionProgress(userId: string, event: {
  type: 'match_won' | 'match_played' | 'kills_scored',
  count: number,
  mode?: string
}) {
  const now = new Date()
  const missions = await prisma.mission.findMany({
    where: {
      isActive: true, weekStart: { lte: now }, weekEnd: { gte: now },
      type: event.type === 'match_won' ? 'WIN_MATCHES'
        : event.type === 'match_played' ? 'PLAY_MATCHES'
        : 'GET_KILLS'
    }
  })

  for (const mission of missions) {
    const existing = await prisma.missionProgress.findUnique({
      where: { userId_missionId: { userId, missionId: mission.id } }
    })

    const newCurrent = Math.min((existing?.current ?? 0) + event.count, mission.target)
    const completed = newCurrent >= mission.target

    await prisma.missionProgress.upsert({
      where: { userId_missionId: { userId, missionId: mission.id } },
      create: { userId, missionId: mission.id, current: newCurrent, completed },
      update: { current: newCurrent, completed }
    })
  }
}
