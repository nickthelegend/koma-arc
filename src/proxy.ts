import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
 if(process.env.KOMA_HOSTED_READ_ONLY === '1' && request.nextUrl.pathname.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(request.method) && request.nextUrl.pathname !== '/api/rpc') {
  return NextResponse.json({error:'Start the local studio server to generate, mint, trade or vote. No hosted payment is taken.'},{status:503});
 }
 return NextResponse.next();
}
export const config={matcher:'/api/:path*'};
