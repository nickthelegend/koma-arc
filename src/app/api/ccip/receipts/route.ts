import { NextResponse } from 'next/server';
import { canonReceiptView } from '@/lib/server/ccip-receipts';
export const dynamic='force-dynamic';
export async function GET() {
 const view=await canonReceiptView();
 return NextResponse.json(view,{status:view.state==='unavailable'?502:200,headers:{'Cache-Control':'no-store'}});
}
