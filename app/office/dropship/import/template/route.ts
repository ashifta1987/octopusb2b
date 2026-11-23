import { NextResponse } from 'next/server';
import { requireDropshipStaff } from '@/lib/dropship-staff';

export async function GET() {
  await requireDropshipStaff(false);
  const csv = [
    'octopus_sku,title,description,category,weight_g,unit_cost_cents,min_order_qty,stock_status,stock_qty,source_type,supplier_code,supplier_sku,origin_country,specs_json',
    'OCT-DS-1001,"Cordless Rechargeable Desk Lamp","Aluminium desk lamp with 3 colour modes. Plain unbranded outer box.","Lighting",540,780,1,in_stock,250,partner_supplier,OCT-1132,MDL-LAMP-01,CN,"{""Material"":""Aluminium"",""Wattage"":""12W""}"',
  ].join('\n');
  return new NextResponse(csv + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dropship-products-template.csv"',
    },
  });
}
