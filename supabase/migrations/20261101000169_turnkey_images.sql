-- Turnkey project photos (owner upload, 7 Nov 2026): 25 images (1200×800 JPEG) in the public "banners" bucket under turnkey/.
-- Adds hero_image_alt (alt text supplied with the photos) and sets image + alt per project title. Audited.
alter table turnkey_projects add column if not exists hero_image_alt text;

do $$
declare r record; v_n int := 0;
begin
  for r in select * from (values
  ('Vending network', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/01-vending.jpg', 'Three snack and drink vending machines in a modern transit concourse'),
  ('Gym fit-out', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/02-gym.jpg', 'Modern gym with cardio and strength training equipment'),
  ('Robotic café kiosk', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/03-robotic-cafe.jpg', 'Robotic café kiosk preparing coffee in a mall'),
  ('Coin / app laundry', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/04-laundry.jpg', 'Self-service laundromat with washers and dryers'),
  ('Hotel / apartment FF&E', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/05-hotel-ffe.jpg', 'Coordinated furniture and fixtures in a modern hotel guest room'),
  ('Solar + battery backup', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/06-solar.jpg', 'Commercial rooftop solar panels with battery backup equipment'),
  ('Parcel lockers & power-bank rental', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/07-lockers.jpg', 'Smart parcel lockers and power-bank rental station in a building lobby'),
  ('Purified water & ice vending', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/08-water-vending.jpg', 'Purified water and ice vending kiosk at a shopping forecourt'),
  ('Cold rooms & cold storage', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/09-cold-room.jpg', 'Commercial walk-in cold room with organized produce shelves'),
  ('Mini-mart fit-out', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/10-minimart.jpg', 'Mini-mart with shelves, refrigerated cases and checkout counter'),
  ('Claw machines & FEC', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/11-claw-fec.jpg', 'Family entertainment center with a row of claw machines'),
  ('Laser engraving & signage', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/12-laser-signage.jpg', 'Signage workshop with laser engraver, UV printer and CNC router'),
  ('Padel & pickleball courts', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/13-padel-court.jpg', 'Modern padel and pickleball courts with players'),
  ('Bubble tea / bakery fit-out', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/14-bubble-tea.jpg', 'Bubble tea shop with drink station and pastry display'),
  ('Concrete block & paver', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/15-block-making.jpg', 'Concrete block-making line with stacked blocks and pavers'),
  ('Feed pellet / flour mill', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/16-feed-mill.jpg', 'Small feed pellet and flour mill with bagging station'),
  ('Container café / shop', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/17-container-cafe.jpg', 'Shipping container converted into a café and shop'),
  ('Paper cup & tissue making', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/18-paper-cup.jpg', 'Paper cup and tissue production equipment in a small factory'),
  ('Plastic injection / recycling line', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/19-injection-moulding.jpg', 'Plastic injection moulding machine and recycling equipment'),
  ('Water bottling plant', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/20-water-bottling.jpg', 'Water bottling production line with bottles on a conveyor'),
  ('VR / 5D cinema zone', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/21-vr-cinema.jpg', 'VR cinema zone with motion seats and headsets'),
  ('Cloud kitchen', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/22-cloud-kitchen.jpg', 'Commercial cloud kitchen with cooking and prep equipment'),
  ('Trampoline & indoor playground', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/23-trampoline-park.jpg', 'Indoor trampoline park with padded play zones and safety nets'),
  ('Touchless car wash', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/24-car-wash.jpg', 'Automatic touchless car wash bay with a vehicle'),
  ('EV charging hub', 'https://qrawnqpxvtjmgncxmffu.supabase.co/storage/v1/object/public/banners/turnkey/25-ev-charging.jpg', 'Electric vehicle charging hub with fast chargers and canopy')
  ) as t(title, url, alt) loop
    update turnkey_projects set hero_image_path = r.url, hero_image_alt = r.alt, updated_at = now() where title = r.title;
    if not found then raise exception 'turnkey project not found: %', r.title; end if;
    v_n := v_n + 1;
  end loop;
  perform write_audit('turnkey.images_set', 'turnkey_projects', null, jsonb_build_object('projects', v_n, 'bucket', 'banners/turnkey'));
end $$;
