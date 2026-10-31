const workerUrl = import.meta.env.VITE_TRAVEL_WORKER_URL || 'https://travel-agent-worker.mkarlen96.workers.dev'

const views = {
    welcome: document.getElementById('welcome-view'),
    form: document.getElementById('form-view'),
    trip: document.getElementById('trip-view')
}
const form = views.form
const travellersOut = document.getElementById('travellers')
const planBtn = document.getElementById('plan-btn')
const formError = document.getElementById('form-error')
const imageBtn = document.getElementById('image-btn')

let travellers = 1
let current = null // { trip, plan } — what the "Your Trip" screen shows

function show(name) {
    for (const [key, view] of Object.entries(views)) view.hidden = key !== name
    window.scrollTo(0, 0)
}

// ---------- 1. Welcome ----------
document.getElementById('begin').addEventListener('click', () => show('form'))

// ---------- 2. Form ----------
function setTravellers(n) {
    travellers = Math.min(20, Math.max(1, n))
    travellersOut.textContent = travellers
}
document.getElementById('minus').addEventListener('click', () => setTravellers(travellers - 1))
document.getElementById('plus').addEventListener('click', () => setTravellers(travellers + 1))

// Default: a one-week trip starting a month from now
const today = new Date()
const isoDate = (d) => d.toISOString().slice(0, 10)
form.startDate.value = isoDate(new Date(today.getTime() + 30 * 86_400_000))
form.endDate.value = isoDate(new Date(today.getTime() + 37 * 86_400_000))

form.addEventListener('submit', async (e) => {
    e.preventDefault()
    formError.hidden = true
    const trip = {
        travellers,
        from: form.from.value.trim(),
        to: form.to.value.trim(),
        startDate: form.startDate.value,
        endDate: form.endDate.value,
        budget: Number(form.budget.value)
    }
    if (trip.startDate > trip.endDate) {
        formError.textContent = 'The return date must be after the departure date.'
        formError.hidden = false
        return
    }

    planBtn.disabled = true
    planBtn.textContent = 'Planning your trip...'
    try {
        const res = await fetch(`${workerUrl}/plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trip)
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Worker error ${res.status}`)
        renderTrip(trip, data)
        history.replaceState(null, '', `#trip=${encodeShare({ trip, plan: data })}`)
    } catch (err) {
        console.error(err)
        formError.textContent = `Something went wrong: ${err.message}`
        formError.hidden = false
    } finally {
        planBtn.disabled = false
        planBtn.textContent = 'Plan my Trip!'
    }
})

// ---------- 3. Your Trip ----------
function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// "2023-11-25" -> "25th Nov 23"
function formatDate(iso) {
    const d = new Date(`${iso}T00:00:00`)
    return `${ordinal(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })} ${String(d.getFullYear()).slice(2)}`
}

function renderTrip(trip, plan) {
    current = { trip, plan }
    document.getElementById('start-chip').textContent = `→ ${formatDate(trip.startDate)}`
    document.getElementById('end-chip').textContent = `${formatDate(trip.endDate)} ←`
    document.getElementById('route-chip').textContent = `${trip.from} → ${trip.to}`
    document.getElementById('weather').textContent = plan.weather
    document.getElementById('flights').textContent = plan.flights
    document.getElementById('hotel').textContent = plan.hotel

    const activities = document.getElementById('activities')
    activities.replaceChildren(...plan.activities.map((text) => {
        const li = document.createElement('li')
        li.textContent = text
        return li
    }))

    // "Book" opens a search with the details prefilled
    document.getElementById('flights-link').href =
        `https://www.google.com/travel/flights?q=${encodeURIComponent(`Flights from ${trip.from} to ${trip.to} on ${trip.startDate} through ${trip.endDate}`)}`
    const hotelParams = new URLSearchParams({
        ss: `${plan.hotelName}, ${trip.to}`,
        checkin: trip.startDate,
        checkout: trip.endDate,
        group_adults: trip.travellers
    })
    document.getElementById('hotel-link').href = `https://www.booking.com/searchresults.html?${hotelParams}`

    document.getElementById('image-box').hidden = true
    imageBtn.hidden = false
    imageBtn.disabled = false
    imageBtn.textContent = '✨ Generate an AI postcard of this place'
    show('trip')
}

// Stretch goal: AI-generated image. Only on button click — every image costs money
imageBtn.addEventListener('click', async () => {
    imageBtn.disabled = true
    imageBtn.textContent = 'Drawing your postcard...'
    try {
        const res = await fetch(`${workerUrl}/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ destination: current.trip.to })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Worker error ${res.status}`)
        const img = document.getElementById('trip-image')
        img.src = data.image
        img.alt = `AI-generated postcard of ${current.trip.to}`
        document.getElementById('image-box').hidden = false
        imageBtn.hidden = true
    } catch (err) {
        console.error(err)
        imageBtn.disabled = false
        imageBtn.textContent = `Couldn't draw it (${err.message}). Try again`
    }
})

// Stretch goal: shareable trip page. The whole trip lives in the link (#trip=...); the server stores nothing
function encodeShare(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data))
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeShare(str) {
    const bin = atob(str.replaceAll('-', '+').replaceAll('_', '/'))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
}

const shareBtn = document.getElementById('share-btn')
shareBtn.addEventListener('click', async () => {
    const url = location.href
    try {
        if (navigator.share) await navigator.share({ title: `Trip to ${current.trip.to}`, url })
        else {
            await navigator.clipboard.writeText(url)
            shareBtn.textContent = 'Link copied!'
            setTimeout(() => { shareBtn.textContent = 'Share trip' }, 2000)
        }
    } catch {
        // User closed the share dialog — do nothing
    }
})

document.getElementById('new-trip').addEventListener('click', () => {
    history.replaceState(null, '', location.pathname)
    show('form')
})

// Opened via a "Share trip" link — show the trip right away
const shared = location.hash.match(/^#trip=(.+)$/)
if (shared) {
    try {
        const { trip, plan } = decodeShare(shared[1])
        renderTrip(trip, plan)
    } catch (err) {
        console.error('Broken share link', err)
    }
}
