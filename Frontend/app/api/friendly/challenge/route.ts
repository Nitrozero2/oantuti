import {NextResponse} from 'next/server';
function retired(){return NextResponse.json({error:'Thách đấu đã được thay bằng thử sức riêng tư.',code:'FEATURE_RETIRED'},{status:410});}
export const GET=retired;
export const POST=retired;
