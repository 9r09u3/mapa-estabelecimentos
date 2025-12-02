import { NextRequest, NextResponse } from "next/server";
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Variáveis de ambiente do Supabase não configuradas");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pendingId, userEmail } = body;
    
    if (!pendingId || !userEmail) {
      return NextResponse.json({ 
        success: false, 
        error: "Dados incompletos" 
      }, { status: 400 });
    }

    if (!/^[0-9a-f-]+$/.test(pendingId)) {
      return NextResponse.json({ 
        success: false, 
        error: "ID inválido" 
      }, { status: 400 });
    }

    const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    if (!adminEmails.includes(userEmail.toLowerCase())) {
      console.warn(`🚨 Tentativa de acesso não autorizado: ${userEmail}`);
      return NextResponse.json({ 
        success: false, 
        error: "Não autorizado" 
      }, { status: 403 });
    }

    const { data: pend, error: pendError } = await supabase
      .from("pending_establishments")
      .select("*")
      .eq("id", pendingId)
      .single();

    if (pendError || !pend) {
      console.warn(`🚨 Tentativa de aprovar estabelecimento inexistente: ${pendingId}`);
      return NextResponse.json({ 
        success: false, 
        error: "Estabelecimento pendente não encontrado" 
      }, { status: 404 });
    }

    if (!pend.name || pend.name.trim().length < 2) {
      return NextResponse.json({ 
        success: false, 
        error: "Nome do estabelecimento inválido" 
      }, { status: 400 });
    }

    const lat = Number(pend.lat);
    const lng = Number(pend.lng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ 
        success: false, 
        error: "Coordenadas inválidas" 
      }, { status: 400 });
    }

    const { data: newEst, error: insertErr } = await supabase
      .from("establishments")
      .insert([{
        name: pend.name.trim(),
        address: pend.address ? pend.address.trim() : "",
        lat: lat,
        lng: lng,
        has_water: Boolean(pend.has_water),
        has_bathroom: Boolean(pend.has_bathroom),
        has_power: Boolean(pend.has_power)
      }])
      .select()
      .single();

    if (insertErr) {
      console.error("Erro ao criar estabelecimento:", insertErr);
      return NextResponse.json({ 
        success: false, 
        error: "Erro ao criar estabelecimento" 
      }, { status: 500 });
    }

    const { data: matches } = await supabase
      .from("reviews")
      .select("*")
      .ilike("moderator_note", `%pending_establishment_id:${pendingId}%`);

    if (matches && matches.length > 0) {
      for (const r of matches) {
        await supabase
          .from("reviews")
          .update({ establishment_id: newEst.id })
          .eq("id", r.id);
      }
    }

    await supabase
      .from("pending_establishments")
      .delete()
      .eq("id", pendingId);

    console.log(`✅ Estabelecimento aprovado: ${newEst.id} por ${userEmail}`);

    return NextResponse.json({ 
      success: true,
      establishmentId: newEst.id
    });

  } catch (error) {
    console.error("Erro ao aprovar estabelecimento:", error);
    return NextResponse.json({ 
      success: false, 
      error: "Erro interno do servidor" 
    }, { status: 500 });
  }
}

export {};