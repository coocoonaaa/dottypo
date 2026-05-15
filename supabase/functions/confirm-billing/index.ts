import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { paymentKey, orderId, amount, plan, userId } = await req.json()
    if (!paymentKey || !orderId || !amount || !plan || !userId) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS })
    }

    const TOSS_SECRET = Deno.env.get('TOSS_SECRET_KEY')!
    const authHeader  = 'Basic ' + btoa(TOSS_SECRET + ':')

    // Confirm payment with TossPayments
    const confirmRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method:  'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ paymentKey, orderId, amount }),
    })
    const payment = await confirmRes.json()

    if (payment.status !== 'DONE') {
      return new Response(JSON.stringify({ error: payment }), { status: 400, headers: CORS })
    }

    // Update subscription in DB
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const expiresAt = new Date()
    if (plan === 'yearly') expiresAt.setFullYear(expiresAt.getFullYear() + 1)
    else expiresAt.setMonth(expiresAt.getMonth() + 1)

    const { error: dbErr } = await supabase.from('profiles').update({
      subscription_status:     'pro',
      subscription_plan:       plan,
      subscription_expires_at: expiresAt.toISOString(),
    }).eq('id', userId)

    if (dbErr) return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers: CORS })

    return new Response(
      JSON.stringify({ success: true, expiresAt: expiresAt.toISOString() }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS })
  }
})
