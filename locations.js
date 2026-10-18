// IMD spells district names differently across its products. `imdKey` folds the usual
// variations (TH/T, doubled letters); `imd` lists spellings that need an explicit alias.
export const imdKey = (s) => s.toUpperCase().replace(/[^A-Z]/g, '').replace(/TH/g, 'T').replace(/(.)\1+/g, '$1');

// District headquarters for all 38 districts of Tamil Nadu. `ta` holds Tamil names (and short
// forms used in headlines); `aka` holds other English names, both used to tag news stories.
export const DISTRICTS = [
  { name: 'Ariyalur', lat: 11.14, lon: 79.08, ta: ['அரியலூர்'] },
  { name: 'Chengalpattu', lat: 12.69, lon: 79.98, ta: ['செங்கல்பட்டு'] },
  { name: 'Chennai', lat: 13.08, lon: 80.27, ta: ['சென்னை'] },
  { name: 'Coimbatore', lat: 11.02, lon: 76.96, ta: ['கோயம்புத்தூர்', 'கோவை'] },
  { name: 'Cuddalore', lat: 11.75, lon: 79.75, ta: ['கடலூர்'] },
  { name: 'Dharmapuri', lat: 12.13, lon: 78.16, ta: ['தர்மபுரி'] },
  { name: 'Dindigul', lat: 10.36, lon: 77.98, ta: ['திண்டுக்கல்'] },
  { name: 'Erode', lat: 11.34, lon: 77.72, ta: ['ஈரோடு'] },
  { name: 'Kallakurichi', lat: 11.74, lon: 78.96, ta: ['கள்ளக்குறிச்சி'] },
  { name: 'Kancheepuram', lat: 12.83, lon: 79.70, ta: ['காஞ்சிபுரம்', 'காஞ்சி'], aka: ['Kanchipuram'] },
  { name: 'Kanniyakumari', lat: 8.18, lon: 77.41, imd: ['KANYAKUMARI'], ta: ['கன்னியாகுமரி', 'குமரி'], aka: ['Kanyakumari', 'Nagercoil'] },
  { name: 'Karur', lat: 10.96, lon: 78.08, ta: ['கரூர்'] },
  { name: 'Krishnagiri', lat: 12.52, lon: 78.21, ta: ['கிருஷ்ணகிரி'] },
  { name: 'Madurai', lat: 9.93, lon: 78.12, ta: ['மதுரை'] },
  { name: 'Mayiladuthurai', lat: 11.10, lon: 79.65, ta: ['மயிலாடுதுறை'] },
  { name: 'Nagapattinam', lat: 10.77, lon: 79.84, ta: ['நாகப்பட்டினம்', 'நாகை'] },
  { name: 'Namakkal', lat: 11.22, lon: 78.17, ta: ['நாமக்கல்'] },
  { name: 'Nilgiris', lat: 11.41, lon: 76.70, ta: ['நீலகிரி', 'ஊட்டி'], aka: ['Ooty'] },
  { name: 'Perambalur', lat: 11.23, lon: 78.88, ta: ['பெரம்பலூர்'] },
  { name: 'Pudukkottai', lat: 10.38, lon: 78.82, ta: ['புதுக்கோட்டை'] },
  { name: 'Ramanathapuram', lat: 9.37, lon: 78.83, ta: ['ராமநாதபுரம்'] },
  { name: 'Ranipet', lat: 12.93, lon: 79.33, imd: ['RANIPPETTAI'], ta: ['ராணிப்பேட்டை'] },
  { name: 'Salem', lat: 11.66, lon: 78.15, ta: ['சேலம்'] },
  { name: 'Sivaganga', lat: 9.85, lon: 78.48, imd: ['SIVAGANGAI'], ta: ['சிவகங்கை'] },
  { name: 'Tenkasi', lat: 8.96, lon: 77.30, ta: ['தென்காசி'] },
  { name: 'Thanjavur', lat: 10.79, lon: 79.14, ta: ['தஞ்சாவூர்', 'தஞ்சை'] },
  { name: 'Theni', lat: 10.01, lon: 77.48, ta: ['தேனி'] },
  { name: 'Thoothukudi', lat: 8.76, lon: 78.13, ta: ['தூத்துக்குடி'], aka: ['Tuticorin'] },
  { name: 'Tiruchirappalli', lat: 10.79, lon: 78.70, ta: ['திருச்சிராப்பள்ளி', 'திருச்சி'], aka: ['Trichy', 'Tiruchi'] },
  { name: 'Tirunelveli', lat: 8.71, lon: 77.76, ta: ['திருநெல்வேலி', 'நெல்லை'], aka: ['Nellai'] },
  { name: 'Tirupathur', lat: 12.50, lon: 78.57, imd: ['TIRUPPATTAR'], ta: ['திருப்பத்தூர்'] },
  { name: 'Tiruppur', lat: 11.11, lon: 77.34, ta: ['திருப்பூர்'] },
  { name: 'Tiruvallur', lat: 13.14, lon: 79.91, ta: ['திருவள்ளூர்'], aka: ['Thiruvallur'] },
  { name: 'Tiruvannamalai', lat: 12.23, lon: 79.07, ta: ['திருவண்ணாமலை'] },
  { name: 'Tiruvarur', lat: 10.77, lon: 79.64, ta: ['திருவாரூர்'] },
  { name: 'Vellore', lat: 12.92, lon: 79.13, ta: ['வேலூர்'] },
  { name: 'Viluppuram', lat: 11.94, lon: 79.49, ta: ['விழுப்புரம்'], aka: ['Villupuram'] },
  { name: 'Virudhunagar', lat: 9.58, lon: 77.96, ta: ['விருதுநகர்'] },
];

// Chennai neighbourhoods, including the two IMD observatories and flood-prone areas.
export const CHENNAI_AREAS = [
  { name: 'Nungambakkam', lat: 13.06, lon: 80.24 },
  { name: 'Meenambakkam', lat: 12.99, lon: 80.18 },
  { name: 'Ennore', lat: 13.22, lon: 80.32 },
  { name: 'Manali', lat: 13.17, lon: 80.26 },
  { name: 'Red Hills', lat: 13.19, lon: 80.18 },
  { name: 'Avadi', lat: 13.115, lon: 80.10 },
  { name: 'Anna Nagar', lat: 13.085, lon: 80.21 },
  { name: 'T. Nagar', lat: 13.04, lon: 80.234 },
  { name: 'Porur', lat: 13.035, lon: 80.157 },
  { name: 'Adyar', lat: 13.006, lon: 80.257 },
  { name: 'Velachery', lat: 12.98, lon: 80.22 },
  { name: 'Perungudi', lat: 12.96, lon: 80.24 },
  { name: 'Sholinganallur', lat: 12.90, lon: 80.227 },
  { name: 'Tambaram', lat: 12.925, lon: 80.127 },
];
