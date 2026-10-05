import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Weekly missions
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1) // Monday

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6) // Sunday
  weekEnd.setHours(23, 59, 59, 999)

  await prisma.mission.createMany({
    skipDuplicates: true,
    data: [
      { title: 'Первая победа', description: 'Выиграй 1 матч на этой неделе', type: 'WIN_MATCHES', target: 1, reward: 50, weekStart, weekEnd },
      { title: 'На разогреве', description: 'Сыграй 5 матчей', type: 'PLAY_MATCHES', target: 5, reward: 100, weekStart, weekEnd },
      { title: 'Снайпер', description: 'Набери 30 убийств за неделю', type: 'GET_KILLS', target: 30, reward: 150, weekStart, weekEnd },
      { title: 'Серийный победитель', description: 'Выиграй 5 матчей за неделю', type: 'WIN_MATCHES', target: 5, reward: 300, weekStart, weekEnd }
    ]
  })

  console.log('✅ Missions created')
  console.log('🎉 Seed complete!')
}

main().catch(console.error).finally(() => prisma.$disconnect())
