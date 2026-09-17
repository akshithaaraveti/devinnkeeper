import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FIRST_ROOM_NUMBER = 101;
const LAST_ROOM_NUMBER = 200;
const FLOOR_COUNT = 4;
const DEFAULT_STATUS = 'vacant';

async function selectHotel() {
  const hotels = await prisma.hotel.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, hotel_name: true },
  });

  if (hotels.length === 0) {
    throw new Error('No Hotel records found. Create a hotel before adding rooms.');
  }

  if (process.env.HOTEL_ID) {
    const hotelId = Number(process.env.HOTEL_ID);
    const hotel = hotels.find((candidate) => candidate.id === hotelId);
    if (!hotel) {
      throw new Error(`HOTEL_ID=${process.env.HOTEL_ID} does not match an existing Hotel.`);
    }
    return { hotels, hotel };
  }

  if (hotels.length > 1) {
    throw new Error('Multiple Hotel records found. Re-run with HOTEL_ID set explicitly.');
  }

  return { hotels, hotel: hotels[0] };
}

async function main() {
  const { hotels, hotel } = await selectHotel();
  const roomTypes = await prisma.roomType.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, name: true, base_price: true },
  });

  console.log('Existing hotels:', hotels);
  console.log('Selected hotel:', hotel);
  console.log('Existing room types:', roomTypes);

  if (roomTypes.length === 0) {
    throw new Error('No RoomType records found. Create at least one room type before adding rooms.');
  }

  const rooms = [];
  for (let roomNumber = FIRST_ROOM_NUMBER; roomNumber <= LAST_ROOM_NUMBER; roomNumber += 1) {
    const roomType = roomTypes[(roomNumber - FIRST_ROOM_NUMBER) % roomTypes.length];
    const floor = Math.floor((roomNumber - FIRST_ROOM_NUMBER) / (100 / FLOOR_COUNT)) + 1;

    rooms.push({
      room_number: String(roomNumber),
      room_type_id: roomType.id,
      floor,
      status: DEFAULT_STATUS,
      current_price: roomType.base_price,
      availability: true,
      hotel_id: hotel.id,
    });
  }

  const result = await prisma.room.createMany({
    data: rooms,
    skipDuplicates: true,
  });

  const roomNumbers = rooms.map((room) => room.room_number);
  const insertedRoomNumbers = await prisma.room.findMany({
    where: {
      hotel_id: hotel.id,
      room_number: { in: roomNumbers },
    },
    select: { room_number: true },
    orderBy: { room_number: 'asc' },
  });

  console.log(`Created ${result.count} new rooms.`);
  console.log(`Rooms 101-200 present after the run: ${insertedRoomNumbers.length}/100.`);

  if (insertedRoomNumbers.length !== rooms.length) {
    const present = new Set(insertedRoomNumbers.map((room) => room.room_number));
    const missing = roomNumbers.filter((roomNumber) => !present.has(roomNumber));
    throw new Error(`Some requested room numbers are missing: ${missing.join(', ')}`);
  }
}

main()
  .catch((error) => {
    console.error('Room insertion failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });