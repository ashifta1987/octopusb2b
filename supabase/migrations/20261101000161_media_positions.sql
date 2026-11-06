-- ADDON-33: product_media.sort = image position 1, 2, 3 … everywhere (the single form used 0-based, imports 1-based).
with r as (select id, row_number() over (partition by product_id order by sort, id) rn from product_media)
update product_media m set sort = r.rn from r where r.id = m.id and m.sort is distinct from r.rn;
