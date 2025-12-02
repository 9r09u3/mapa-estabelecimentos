import { NextRequest, NextResponse } from "next/server";

const ADMIN_EMAILS = process.env.ADMIN_EMAILS?.split(',') || [];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;
    
    if (!email) {
      return NextResponse.json({ 
        isAdmin: false, 
        error: "Email é obrigatório" 
      }, { status: 400 });
    }

    const isAdmin = ADMIN_EMAILS.includes(email.trim().toLowerCase());
    
    console.log(`Tentativa de verificação admin: ${email} - ${isAdmin ? 'APROVADO' : 'NEGADO'}`);

    return NextResponse.json({ 
      isAdmin,
      message: isAdmin ? "Email verificado" : "Acesso negado"
    });

  } catch (error) {
    console.error("Erro na verificação admin:", error);
    return NextResponse.json({ 
      isAdmin: false, 
      error: "Erro interno do servidor" 
    }, { status: 500 });
  }
}

export {};