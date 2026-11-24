import { NextResponse } from 'next/server';
import { requireDropshipStaff } from '@/lib/dropship-staff';

export async function GET() {
  await requireDropshipStaff(false);
  const csv = [
    'import_ref,title,description,category,weight_g,min_order_qty,stock_status,stock_qty,source_type,sourcing_sku,origin_country,specs_json',
    'IMP-LAMP-001,"Cordless Rechargeable Desk Lamp","Aluminium desk lamp with 3 colour modes. Plain unbranded outer box.","Lighting",540,1,in_stock,250,own_warehouse,,CN,"{""Material"":""Aluminium"",""Wattage"":""12W""}"',
  ].join('\n');
  return new NextResponse(csv + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dropship-products-template.csv"',
    },
  });
}
