export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  /** Dietary tags from the API (e.g. 'Vegan'); local items rely on heuristics. */
  tags?: string[];
}

export const categories = ['All', 'Burgers', 'Pizza', 'Pasta', 'Desserts', 'Drinks'];

export const menuItems: MenuItem[] = [
  {
    id: 1,
    name: 'Ember Classic',
    description: 'Heritage beef patty, aged cheddar, caramelized onion, ember aioli on brioche',
    price: 24,
    image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80&auto=format&fit=crop',
    category: 'Burgers',
  },
  {
    id: 2,
    name: 'Forest Truffle Burger',
    description: 'Wagyu beef, black truffle butter, gruyère, wild arugula, toasted sesame bun',
    price: 38,
    image: 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=600&q=80&auto=format&fit=crop',
    category: 'Burgers',
  },
  {
    id: 3,
    name: 'Smoked Mushroom Stack',
    description: 'Portobello, smoked gouda, roasted peppers, herb mayo, ciabatta — plant-based',
    price: 20,
    image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&q=80&auto=format&fit=crop',
    category: 'Burgers',
  },
  {
    id: 4,
    name: 'Margherita di Stagione',
    description: 'San Marzano tomato, buffalo mozzarella, fresh basil, cold-pressed olive oil',
    price: 22,
    image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80&auto=format&fit=crop',
    category: 'Pizza',
  },
  {
    id: 5,
    name: 'Tartufo Bianco',
    description: 'White cream base, black truffle, fontina, thyme, finished with truffle oil',
    price: 36,
    image: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=600&q=80&auto=format&fit=crop',
    category: 'Pizza',
  },
  {
    id: 6,
    name: 'Ember Wild Mushroom',
    description: 'Porcini crème, mixed forest mushrooms, taleggio, rosemary, crispy shallots',
    price: 28,
    image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&q=80&auto=format&fit=crop',
    category: 'Pizza',
  },
  {
    id: 7,
    name: 'Pappardelle al Ragù',
    description: 'Hand-rolled egg pasta, 12-hour slow-cooked venison ragù, parmigiano reggiano',
    price: 32,
    image: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=600&q=80&auto=format&fit=crop',
    category: 'Pasta',
  },
  {
    id: 8,
    name: 'Cacio e Pepe Moderno',
    description: 'Tonnarelli, aged pecorino, tellicherry pepper, a modern take on a Roman classic',
    price: 24,
    image: 'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=600&q=80&auto=format&fit=crop',
    category: 'Pasta',
  },
  {
    id: 9,
    name: 'Lobster Tagliolini',
    description: 'Fresh tagliolini, Nova Scotia lobster, saffron butter, cherry tomatoes, basil',
    price: 48,
    image: 'https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=600&q=80&auto=format&fit=crop',
    category: 'Pasta',
  },
  {
    id: 10,
    name: 'Valrhona Chocolate Fondant',
    description: 'Dark chocolate lava cake, salted caramel, vanilla bean gelato',
    price: 16,
    image: 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=600&q=80&auto=format&fit=crop',
    category: 'Desserts',
  },
  {
    id: 11,
    name: 'Seasonal Tart',
    description: 'Butter pastry, pastry cream, hand-picked seasonal fruits, apricot glaze',
    price: 14,
    image: 'https://images.unsplash.com/photo-1587314168485-3236d6710814?w=600&q=80&auto=format&fit=crop',
    category: 'Desserts',
  },
  {
    id: 12,
    name: 'Panna Cotta al Bosco',
    description: 'Vanilla panna cotta, wild berry coulis, almond tuile',
    price: 13,
    image: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80&auto=format&fit=crop',
    category: 'Desserts',
  },
  {
    id: 13,
    name: 'Forest Negroni',
    description: 'Gin, Campari, sweet vermouth, pine-smoked ice, orange twist',
    price: 18,
    image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&q=80&auto=format&fit=crop',
    category: 'Drinks',
  },
  {
    id: 14,
    name: 'Ember Sour',
    description: 'Bourbon, honey-ginger shrub, lemon, egg white, smoked paprika',
    price: 17,
    image: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=600&q=80&auto=format&fit=crop',
    category: 'Drinks',
  },
  {
    id: 15,
    name: 'House Sparkling Water',
    description: 'Still or sparkling, locally sourced spring water, lemon or cucumber',
    price: 5,
    image: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&q=80&auto=format&fit=crop',
    category: 'Drinks',
  },
];
