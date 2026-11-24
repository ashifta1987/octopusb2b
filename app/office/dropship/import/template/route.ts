import { NextResponse } from 'next/server';
import { requireDropshipStaff } from '@/lib/dropship-staff';

export async function GET() {
  await requireDropshipStaff(false);
  const csv = [
    'src_model_no,product_title,description,category,weight_g,l_cm,w_cm,h_cm,hs,origin,battery,liquid,magnet,powder,color,size,min_order_qty',
    'SRC-EXAMPLE-001,"Cordless Rechargeable Desk Lamp","Aluminium desk lamp with 3 colour modes. Plain unbranded outer box.","Lighting",540,34,13,9,9405.21,CN,yes,no,no,no,"Matte Black",,1',
  ].join('\n');
  return new NextResponse(csv + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dropship-products-template.csv"',
    },
  });
}
