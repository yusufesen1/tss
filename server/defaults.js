/* =========================================================
   defaults.js — js/data.js'teki DEFAULT_* sabitlerinin birebir kopyası
   =========================================================
   Boş bir veritabanı ilk kez açıldığında, kullanıcı bugünkü davranışla
   AYNI başlangıç verisini görsün diye tohumlanır (js/data.js:10-49).
   Bu iki liste birbirine bağlı: js/data.js'teki varsayılanlar
   değişirse burası da güncellenmeli.
   ========================================================= */
'use strict';

var DEFAULT_LOCATIONS = [
  { id: 'loc-1', name: 'AHL Kargo Binası',       lat: 40.980433, lng: 28.830220, from: '00:00', until: '23:59' },
  { id: 'loc-2', name: 'AHL Ulaştırma B Kapısı', lat: 40.985336, lng: 28.818313, from: '00:00', until: '12:00' },
  { id: 'loc-3', name: 'İHL ASG Binası',         lat: 41.253611, lng: 28.714696, from: '00:00', until: '23:59' },
  { id: 'loc-4', name: 'İHL Smartist Kargo',     lat: 41.277568, lng: 28.718970, from: '00:00', until: '23:59' },
  { id: 'loc-5', name: 'ISL-2 Teknik A.Ş.',      lat: 40.987452, lng: 28.818704, from: '00:00', until: '23:59' },
  { id: 'loc-6', name: 'THY Genel Müdürlük',     lat: 40.982539, lng: 28.825014, from: '00:00', until: '23:59' }
];

var DEFAULT_VEHICLES = [
  { id: 'veh-1', plate: '34 HER 841', model: 'Fiat Ducato',     capacity: 5, usable: 5, fuelConsumption: 7,   fuelType: 'dizel' },
  { id: 'veh-2', plate: '34 KVS 889', model: 'Fiat Ducato',     capacity: 5, usable: 5, fuelConsumption: 7,   fuelType: 'dizel' },
  { id: 'veh-3', plate: '34 GTS 710', model: 'Peugeot Partner', capacity: 1, usable: 1, fuelConsumption: 5.8, fuelType: 'dizel' },
  { id: 'veh-4', plate: '34 GTS 744', model: 'Peugeot Partner', capacity: 1, usable: 1, fuelConsumption: 5.8, fuelType: 'dizel' }
];

var DEFAULT_TRAFFIC = {
  enabled: true,
  applyRushHourOnWeekends: false,
  morning: { start: '07:00', end: '09:30', factor: 1.8 },
  evening: { start: '17:00', end: '19:30', factor: 2.2 },
  night:   { start: '23:00', end: '06:00', factor: 1.0 }
};

var DEFAULT_FUEL_PRICE = { dizelPrice: null, benzinPrice: null };

var DEFAULT_FUEL_CONSUMPTION = 7;

module.exports = {
  DEFAULT_LOCATIONS: DEFAULT_LOCATIONS,
  DEFAULT_VEHICLES: DEFAULT_VEHICLES,
  DEFAULT_TRAFFIC: DEFAULT_TRAFFIC,
  DEFAULT_FUEL_PRICE: DEFAULT_FUEL_PRICE,
  DEFAULT_FUEL_CONSUMPTION: DEFAULT_FUEL_CONSUMPTION
};
