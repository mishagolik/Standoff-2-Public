import { Resend } from 'resend'

const resendApiKey = process.env.RESEND_API_KEY || 're_eYsdczXj_KhgQEHwWVdaTUnDDumDJwvtG'
const resend = new Resend(resendApiKey)

export async function sendVerificationEmail(email: string, code: string, username: string) {
  try {
    const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev'
    const result = await resend.emails.send({
      from: `Standoff 2 Arena <${fromEmail}>`,
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
              This code will expire in 15 minutes. If you did not create an account, please disregard this email.
            </p>
          </div>
          <div style="background: #090a0d; padding: 15px; text-align: center; border-top: 1px solid #1a1d26;">
            <p style="margin: 0; color: #555b6d; font-size: 12px;">© 2026 Standoff 2 Arena. Built for competitive players.</p>
          </div>
        </div>
      `
    })
    console.log(`[Email] Verification code ${code} sent to ${email}`, result)
    return { success: true, result }
  } catch (error) {
    console.error('[Email Error] Failed to send verification email:', error)
    return { success: false, error }
  }
}

export async function sendPasswordResetEmail(email: string, code: string) {
  try {
    const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev'
    const result = await resend.emails.send({
      from: `Standoff 2 Arena <${fromEmail}>`,
      to: email,
      subject: `[${code}] Password Reset Code - Standoff 2 Arena`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #0f1015; color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #ff2a44;">
          <div style="background: #ff2a44; padding: 25px; text-align: center;">
            <h1 style="margin: 0; color: #ffffff; font-size: 22px; text-transform: uppercase;">Password Reset Request</h1>
          </div>
          <div style="padding: 30px 25px; text-align: center;">
            <p style="color: #a0a5b5; font-size: 15px; margin-bottom: 25px;">
              Use the following security code to reset your account password:
            </p>
            <div style="background: #1a1c23; border: 2px dashed #ff2a44; border-radius: 10px; padding: 18px; margin: 0 auto 25px; width: fit-content; min-width: 220px;">
              <span style="font-family: monospace; font-size: 34px; font-weight: bold; letter-spacing: 8px; color: #ff334b;">${code}</span>
            </div>
            <p style="color: #6c7284; font-size: 13px;">Code expires in 15 minutes.</p>
          </div>
        </div>
      `
    })
    return { success: true, result }
  } catch (error) {
    console.error('[Email Error] Failed to send reset email:', error)
    return { success: false, error }
  }
}
