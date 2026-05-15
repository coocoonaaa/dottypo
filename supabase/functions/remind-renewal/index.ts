import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find Pro users whose subscription expires in the next 3 days
    const now      = new Date()
    const in3Days  = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, username, subscription_plan, subscription_expires_at')
      .eq('subscription_status', 'pro')
      .gte('subscription_expires_at', now.toISOString())
      .lte('subscription_expires_at', in3Days.toISOString())

    if (error) throw new Error(error.message)
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { headers: CORS })
    }

    // Get user emails from auth.users via service role
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
    let sent = 0

    for (const profile of users) {
      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id)
      const email = authUser?.user?.email
      if (!email) continue

      const expDate = new Date(profile.subscription_expires_at)
      const daysLeft = Math.ceil((expDate.getTime() - now.getTime()) / 86400000)
      const fmt = expDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
      const planLabel = profile.subscription_plan === 'yearly' ? '연간 구독' : '월간 구독'

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'dottypo <noreply@dottypo.com>',
          to: [email],
          subject: `dottypo Pro 구독이 ${daysLeft}일 후 만료됩니다`,
          html: `
            <div style="font-family: 'DM Mono', monospace; max-width: 480px; margin: 0 auto; padding: 40px 24px; color: #2a2a26;">
              <div style="font-size: 20px; font-weight: 700; margin-bottom: 24px;">
                <span style="color: #3a8c00;">dot</span><span>typo</span>
              </div>
              <p style="font-size: 15px; line-height: 1.6;">안녕하세요${profile.username ? ', ' + profile.username : ''}님</p>
              <p style="font-size: 15px; line-height: 1.6;">
                <strong>dottypo Pro ${planLabel}</strong>이 <strong>${fmt}</strong>에 만료됩니다.<br>
                구독을 갱신하지 않으면 무료 플랜으로 전환됩니다.
              </p>
              <div style="background: #f5f5f0; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
                <div style="font-size: 36px; font-weight: 600; color: #3a8c00;">${daysLeft}</div>
                <div style="font-size: 12px; color: #888; margin-top: 4px;">days remaining</div>
              </div>
              <a href="https://dottypo.com" style="display: inline-block; background: #3a8c00; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 13px; letter-spacing: 0.06em;">
                지금 갱신하기
              </a>
              <p style="font-size: 11px; color: #aaa; margin-top: 32px; line-height: 1.6;">
                dottypo는 자동 갱신을 지원하지 않습니다. 만료 전에 직접 갱신해 주세요.
              </p>
            </div>
          `,
        }),
      })

      if (res.ok) sent++
    }

    return new Response(
      JSON.stringify({ sent, total: users.length }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS })
  }
})
