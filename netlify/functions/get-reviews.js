// netlify/functions/get-reviews.js
// Fetches Google Reviews via Places API
// Required env var: GOOGLE_PLACES_API_KEY

exports.handler = async (event) => {
  const PLACE_ID = "ChIJJ5oDKN4_244RKugRQdtw6Lc";
  const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600"
  };

  if (!API_KEY) {
    console.error("GOOGLE_PLACES_API_KEY not set");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=name,rating,user_ratings_total,reviews&reviews_sort=newest&key=${API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();

    console.log("Places API status:", data.status);

    if (data.status !== "OK") {
      console.error("Places API error:", data.status, data.error_message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: data.status, message: data.error_message }) };
    }

    const result = data.result;
    const reviews = (result.reviews || []).map(r => ({
      name: r.author_name,
      stars: r.rating,
      text: r.text,
      date: new Date(r.time * 1000).toLocaleDateString("en-JM", { month: "short", year: "numeric" }),
      photo: r.profile_photo_url || ""
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        name: result.name,
        rating: result.rating,
        total: result.user_ratings_total,
        reviews
      })
    };

  } catch (e) {
    console.error("get-reviews exception:", e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
