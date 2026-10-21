-- Ember & Co. seed — the restaurant's current live content.
insert into public.restaurant_settings (id, kitchen_open, wait_min, wait_max, opening_hours, restaurant_name, phone, email, address)
values (1, true, 20, 30, '{"weekdays": "11:00 AM – 11:00 PM", "weekends": "10:00 AM – 12:00 AM"}'::jsonb,
        'Ember & Co.', '+1 (503) 555-1234', 'hello@emberandco.com', 'Portland, Oregon')
on conflict (id) do nothing;

insert into public.menu_items (id, name, description, price, image_url, category, dietary_tags, is_available, sort_order) values
  (1, 'Ember Classic', 'Heritage beef patty, aged cheddar, caramelized onion, ember aioli on brioche', 24, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80&auto=format&fit=crop', 'Burgers', '{}', true, 0),
  (2, 'Forest Truffle Burger', 'Wagyu beef, black truffle butter, gruyère, wild arugula, toasted sesame bun', 38, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=600&q=80&auto=format&fit=crop', 'Burgers', '{}', true, 1),
  (3, 'Smoked Mushroom Stack', 'Portobello, smoked gouda, roasted peppers, herb mayo, ciabatta — plant-based', 20, 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&q=80&auto=format&fit=crop', 'Burgers', ARRAY['Vegan'], true, 2),
  (4, 'Margherita di Stagione', 'San Marzano tomato, buffalo mozzarella, fresh basil, cold-pressed olive oil', 22, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80&auto=format&fit=crop', 'Pizza', '{}', true, 3),
  (5, 'Tartufo Bianco', 'White cream base, black truffle, fontina, thyme, finished with truffle oil', 36, 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600&q=80&auto=format&fit=crop', 'Pizza', '{}', true, 4),
  (6, 'Ember Wild Mushroom', 'Porcini crème, mixed forest mushrooms, taleggio, rosemary, crispy shallots', 28, 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&q=80&auto=format&fit=crop', 'Pizza', '{}', true, 5),
  (7, 'Pappardelle al Ragù', 'Hand-rolled egg pasta, 12-hour slow-cooked venison ragù, parmigiano reggiano', 32, 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=600&q=80&auto=format&fit=crop', 'Pasta', '{}', true, 6),
  (8, 'Cacio e Pepe Moderno', 'Tonnarelli, aged pecorino, tellicherry pepper, a modern take on a Roman classic', 24, 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=600&q=80&auto=format&fit=crop', 'Pasta', ARRAY['Spicy'], true, 7),
  (9, 'Lobster Tagliolini', 'Fresh tagliolini, Nova Scotia lobster, saffron butter, cherry tomatoes, basil', 48, 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=600&q=80&auto=format&fit=crop', 'Pasta', '{}', true, 8),
  (10, 'Valrhona Chocolate Fondant', 'Dark chocolate lava cake, salted caramel, vanilla bean gelato', 16, 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=600&q=80&auto=format&fit=crop', 'Desserts', '{}', true, 9),
  (11, 'Seasonal Tart', 'Butter pastry, pastry cream, hand-picked seasonal fruits, apricot glaze', 14, 'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=600&q=80&auto=format&fit=crop', 'Desserts', ARRAY['Vegan'], true, 10),
  (12, 'Panna Cotta al Bosco', 'Vanilla panna cotta, wild berry coulis, almond tuile', 13, 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80&auto=format&fit=crop', 'Desserts', ARRAY['Gluten Free'], true, 11),
  (13, 'Forest Negroni', 'Gin, Campari, sweet vermouth, pine-smoked ice, orange twist', 18, 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&q=80&auto=format&fit=crop', 'Drinks', '{}', true, 12),
  (14, 'Ember Sour', 'Bourbon, honey-ginger shrub, lemon, egg white, smoked paprika', 17, 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=600&q=80&auto=format&fit=crop', 'Drinks', '{}', true, 13),
  (15, 'House Sparkling Water', 'Still or sparkling, locally sourced spring water, lemon or cucumber', 5, 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&q=80&auto=format&fit=crop', 'Drinks', ARRAY['Gluten Free'], true, 14)
on conflict (id) do nothing;
select setval(pg_get_serial_sequence('public.menu_items', 'id'), (select max(id) from public.menu_items));
