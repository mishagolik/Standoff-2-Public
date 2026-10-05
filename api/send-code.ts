import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY || 're_eYsdczXj_KhgQEHwWVdaTUnDDumDJwvtG')

export default async function handler(req: any, res: any) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, code, username = 'Agent' } = req.body || {}

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' })
    }

    const { data, error } = await resend.emails.send({
      from: 'Standoff 2 Arena <onboarding@resend.dev>',
      to: email,
      subject: `[${code}] Your Standoff 2 Arena Verification Code`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #0f1015; color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #ff2a44;">
          <div style="background: linear-gradient(135deg, #ff2a44 0%, #b80d22 100%); padding: 30px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 26px; text-transform: uppercase; letter-spacing: 2px;">STANDOFF 2 ARENA</h1>
            <p style="margin: 8px 0 0; color: #ffe6e8; font-size: 14px;">Competitive Matchmaking & ELO Hub</p>
          </div>
          <div style="padding: 30px 25px; text-align: center;">
            <h2 style="color: #ffffff; margin-top: 0; font-size: 20px;">Welcome, Agent ${username}!</h2>
            <p style="color: #a0a5b5; font-size: 15px; line-height: 1.5; margin-bottom: 25px;">
              Enter this 6-digit confirmation code on the platform to verify your account and unlock matchmaking:
            </p>
            <div style="background: #1a1c23; border: 2px dashed #ff2a44; border-radius: 10px; padding: 18px; margin: 0 auto 25px; width: fit-content; min-width: 220px;">
              <span style="font-family: monospace; font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #ff334b;">${code}</span>
            </div>
            <p style="color: #6c7284; font-size: 13px;">
              This code will expire in 15 minutes.
            </p>
          </div>
        </div>
      `
    })

    if (error) {
      console.error('Resend API error:', error)
      return res.status(400).json({ error })
    }

    return res.status(200).json({ success: true, data })
  } catch (err: any) {
    console.error('Server error:', err)
    return res.status(500).json({ error: err.message })
  }
}
