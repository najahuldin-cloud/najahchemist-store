// netlify/functions/get-reviews.js
// Fetches Google reviews for Najah Chemist via Places API
// Required env variable: GOOGLE_PLACES_API_KEY

exports.handler = async function(event) {
  const PLACE_ID = 'ChIJJ5oDKN4_244RKugRQdtw6Lc';
  const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name,rating,user_ratings_total,reviews&reviews_sort=newest&key=${API_KEY}`;
    
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK') {
      return { statusCode: 500, body: JSON.stringify({ error: data.status }) };
    }

    const result = data.result;
    const reviews = (result.reviews || []).map(r => ({
      name: r.author_name,
      stars: r.rating,
      text: r.text,
      date: new Date(r.time * 1000).toLocaleDateString('en-JM', { month: 'short', year: 'numeric' }),
      photo: r.profile_photo_url || ''
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      },
      body: JSON.stringify({
        name: result.name,
        rating: result.rating,
        total: result.user_ratings_total,
        reviews
      })
    };

  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
