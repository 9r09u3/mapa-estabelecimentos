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
    const { pendingIds, userEmail } = body;
    
    if (!pendingIds || !Array.isArray(pendingIds) || pendingIds.length === 0 || !userEmail) {
      return NextResponse.json({ 
        success: false, 
        error: "Dados incompletos" 
      }, { status: 400 });
    }

    // Validar formato dos IDs
    for (const id of pendingIds) {
      if (!/^[0-9a-f-]+$/.test(id)) {
        return NextResponse.json({ 
          success: false, 
          error: "IDs inválidos" 
        }, { status: 400 });
      }
    }

    const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    if (!adminEmails.includes(userEmail.toLowerCase())) {
      console.warn(`🚨 Tentativa de acesso não autorizado: ${userEmail}`);
      return NextResponse.json({ 
        success: false, 
        error: "Não autorizado" 
      }, { status: 403 });
    }

    // Buscar todos os estabelecimentos pendentes
    const { data: pendingList, error: pendError } = await supabase
      .from("pending_establishments")
      .select("*")
      .in("id", pendingIds);

    if (pendError) {
      console.error("Erro ao buscar estabelecimentos pendentes:", pendError);
      return NextResponse.json({ 
        success: false, 
        error: "Erro ao buscar estabelecimentos" 
      }, { status: 500 });
    }

    if (!pendingList || pendingList.length === 0) {
      console.warn(`🚨 Tentativa de aprovar estabelecimentos inexistentes: ${pendingIds}`);
      return NextResponse.json({ 
        success: false, 
        error: "Estabelecimentos pendentes não encontrados" 
      }, { status: 404 });
    }

    const approvedIds = [];
    const errors = [];

    // Processar cada estabelecimento
    for (const pend of pendingList) {
      try {
        if (!pend.name || pend.name.trim().length < 2) {
          errors.push({ id: pend.id, name: pend.name, error: "Nome inválido" });
          continue;
        }

        const lat = Number(pend.lat);
        const lng = Number(pend.lng);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          errors.push({ id: pend.id, name: pend.name, error: "Coordenadas inválidas" });
          continue;
        }

        // Inserir na tabela de estabelecimentos
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
          console.error(`Erro ao criar estabelecimento ${pend.id}:`, insertErr);
          errors.push({ id: pend.id, name: pend.name, error: "Erro ao criar estabelecimento" });
          continue;
        }

        approvedIds.push(newEst.id);

        // Atualizar avaliações pendentes associadas
        const { data: matches } = await supabase
          .from("reviews")
          .select("*")
          .ilike("moderator_note", `%pending_establishment_id:${pend.id}%`);

        if (matches && matches.length > 0) {
          for (const r of matches) {
            await supabase
              .from("reviews")
              .update({ establishment_id: newEst.id })
              .eq("id", r.id);
          }
        }

        // Remover do pendente
        await supabase
          .from("pending_establishments")
          .delete()
          .eq("id", pend.id);

      } catch (error) {
        console.error(`Erro ao processar estabelecimento ${pend.id}:`, error);
        errors.push({ id: pend.id, name: pend.name, error: "Erro interno" });
      }
    }

    console.log(`✅ Estabelecimentos aprovados em massa: ${approvedIds.length} por ${userEmail}`);

    return NextResponse.json({ 
      success: true,
      approvedCount: approvedIds.length,
      errorCount: errors.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("Erro ao aprovar estabelecimentos em massa:", error);
    return NextResponse.json({ 
      success: false, 
      error: "Erro interno do servidor" 
    }, { status: 500 });
  }
}

// Adiciona exportação vazia para resolver o erro de módulo
export {};