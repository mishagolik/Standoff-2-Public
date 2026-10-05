import { prisma } from '../../db/prisma'
import { MatchMode, TeamSide } from '@prisma/client'

const K_FACTOR = {
  FIVE_VS_FIVE: 30,
  TWO_VS_TWO: 20
}

// Expected score for player A against player B
function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400))
}

// Calculate new ELO
function calcNewElo(elo: number, expected: number, actual: number, k: number): number {
  return Math.round(elo + k * (actual - expected))
}

export async function processMatchElo(matchId: string, mode: MatchMode, winningSide: TeamSide) {
  const players = await prisma.matchPlayer.findMany({
    where: { matchId },
    include: { user: true }
  })

  const teamA = players.filter(p => p.team === 'TEAM_A')
  const teamB = players.filter(p => p.team === 'TEAM_B')

  const avgEloA = teamA.reduce((s, p) => s + p.user.elo, 0) / teamA.length
  const avgEloB = teamB.reduce((s, p) => s + p.user.elo, 0) / teamB.length

  const k = K_FACTOR[mode]

  for (const player of players) {
    const isTeamA = player.team === 'TEAM_A'
    const myTeamAvg = isTeamA ? avgEloA : avgEloB
    const oppTeamAvg = isTeamA ? avgEloB : avgEloA
    const won = (isTeamA && winningSide === 'TEAM_A') || (!isTeamA && winningSide === 'TEAM_B')

    const expected = expectedScore(myTeamAvg, oppTeamAvg)
    const actual = won ? 1 : 0
    const delta = calcNewElo(player.user.elo, expected, actual, k) - player.user.elo

    const newElo = Math.max(100, player.user.elo + delta) // floor at 100

    await prisma.$transaction([
      prisma.user.update({
        where: { id: player.userId },
        data: {
          elo: newElo,
          wins: won ? { increment: 1 } : undefined,
          losses: !won ? { increment: 1 } : undefined,
          points: won ? { increment: 10 } : { increment: 3 }
        }
      }),
      prisma.matchPlayer.update({
        where: { id: player.id },
        data: { eloDelta: delta }
      }),
      prisma.eloHistory.create({
        data: {
          userId: player.userId,
          matchId,
          delta,
          eloAfter: newElo,
          reason: `Match ${mode} - ${won ? 'WIN' : 'LOSS'}`
        }
      })
    ])
  }
}
