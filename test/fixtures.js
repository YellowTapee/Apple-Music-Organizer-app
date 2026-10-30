// Synthetic fixtures for deterministic matching tests.
// These are test data only. They are NOT Apple Music data and must never be
// shown in the app as if they came from a real library.

export const playlist20 = [
  { id: '1', title: 'Alpha', artist: 'Drake', album: 'Album One' },
  { id: '2', title: 'Bravo', artist: 'Future', album: 'Album Two' },
  { id: '3', title: 'Charlie', artist: 'Drake', album: 'Album One' },
  { id: '4', title: 'Delta', artist: 'Kendrick Lamar', album: 'Album Three' },
  { id: '5', title: 'Echo', artist: 'SZA', album: 'Album Four' },
  { id: '6', title: 'Foxtrot (feat. Drake)', artist: 'Future', album: 'Album Two' },
  { id: '7', title: 'Golf', artist: 'Drake & Future', album: 'Collab' },
  { id: '8', title: 'Hotel', artist: 'Kendrick Lamar feat. SZA', album: 'Album Three' },
  { id: '9', title: 'India', artist: 'Tyler, The Creator', album: 'Album Five' },
  { id: '10', title: 'Juliet', artist: 'Drake', album: 'Album Six' },
  { id: '11', title: 'Kilo', artist: 'Future', album: 'Album Two' },
  { id: '12', title: 'Lima', artist: 'SZA', album: 'Album Four' },
  { id: '13', title: 'Mike', artist: 'Kendrick Lamar', album: 'Album Seven' },
  { id: '14', title: 'November', artist: 'Tyler, The Creator', album: 'Album Five' },
  { id: '15', title: 'Oscar', artist: 'Drake', album: 'Album Six' },
  { id: '16', title: 'Papa', artist: 'Future', album: 'Album Eight' },
  { id: '17', title: 'Quebec', artist: 'SZA', album: 'Album Four' },
  { id: '18', title: 'Romeo', artist: 'Kendrick Lamar', album: 'Album Three' },
  { id: '19', title: 'Sierra', artist: 'Drake', album: 'Album One' },
  { id: '20', title: 'Tango', artist: 'Future', album: 'Album Eight' },
];

export function deepFreeze(obj) {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return obj;
}
