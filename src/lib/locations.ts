export type Location = {
  id: string;
  name: string;
  type: "Head Office" | "Branch" | "Business Centre" | "ATM";
  address: string;
  hours: string;
  phone: string;
  coords: [number, number];
};

/** Demo data — swap these for real branch records from your API. */
export const LOCATIONS: Location[] = [
  {
    id: "menara-ambank",
    name: "Menara AmBank",
    type: "Head Office",
    address: "8, Jalan Yap Kwan Seng, 50450 Kuala Lumpur",
    hours: "Mon–Fri · 9:00–17:00",
    phone: "+60 3-2168 8000",
    coords: [3.16157, 101.71979],
  },
  {
    id: "klcc",
    name: "AmBank KLCC",
    type: "Branch",
    address: "Lot C29, Concourse Level, Suria KLCC, 50088 KL",
    hours: "Daily · 10:00–20:00",
    phone: "+60 3-2382 0288",
    coords: [3.1582, 101.7116],
  },
  {
    id: "bangsar",
    name: "AmBank Bangsar Baru",
    type: "Branch",
    address: "57, Jalan Telawi 3, Bangsar Baru, 59100 KL",
    hours: "Mon–Fri · 9:15–16:45",
    phone: "+60 3-2282 3388",
    coords: [3.1279, 101.6706],
  },
  {
    id: "mid-valley",
    name: "AmBank Mid Valley",
    type: "Business Centre",
    address: "T-025, Third Floor, Mid Valley Megamall, 59200 KL",
    hours: "Daily · 10:00–19:00",
    phone: "+60 3-2289 7788",
    coords: [3.1179, 101.6775],
  },
  {
    id: "damansara",
    name: "AmBank Damansara Heights",
    type: "Branch",
    address: "12A, Jalan Dungun, Bukit Damansara, 50490 KL",
    hours: "Mon–Fri · 9:00–17:00",
    phone: "+60 3-2094 1166",
    coords: [3.1499, 101.6663],
  },
  {
    id: "sunway",
    name: "AmBank Sunway Pyramid",
    type: "ATM",
    address: "G-08, Sunway Pyramid, 3 Jalan PJS 11/15, 47500 Subang Jaya",
    hours: "24 hours",
    phone: "+60 3-7491 8000",
    coords: [3.0726, 101.6072],
  },
];
