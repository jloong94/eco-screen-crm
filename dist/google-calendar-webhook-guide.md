# Eco Screen Google Calendar Webhook Setup

This CRM can create Google Calendar events automatically through a Google Apps Script Web App URL.

## Vercel Environment Variable

Add this in Vercel Project Settings -> Environment Variables:

```text
NEXT_PUBLIC_GOOGLE_CALENDAR_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

## Google Apps Script Code

Create a Google Apps Script project and paste this code:

```javascript
const CALENDAR_ID = "primary";

function doPost(e) {
  const payload = JSON.parse(e.postData.contents || "{}");
  if (payload.action === "pull") return pullAppointments();
  return upsertAppointment(payload.appointment || {});
}

function upsertAppointment(appointment) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const title = `[Site Measurement] ${appointment.customerName || "Customer"}`;
  const start = new Date(`${appointment.appointmentDate}T${appointment.appointmentTime || "09:00"}:00+08:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const description = [
    appointment.customerName || "",
    appointment.phone || "",
    appointment.address || "",
    appointment.product || "",
    appointment.remarks || ""
  ].join("\n");

  let event = null;
  if (appointment.googleEventId) {
    try {
      event = calendar.getEventById(appointment.googleEventId);
    } catch (err) {}
  }

  if (event) {
    event.setTitle(title);
    event.setTime(start, end);
    event.setDescription(description);
    event.setLocation(appointment.address || "");
  } else {
    event = calendar.createEvent(title, start, end, {
      description,
      location: appointment.address || ""
    });
  }

  return json({
    eventId: event.getId(),
    htmlLink: event.getGuestList ? "" : "",
    googleEventLink: `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(event.getId())}`
  });
}

function pullAppointments() {
  return json({ appointments: [] });
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Deploy as:

1. Deploy -> New deployment
2. Type: Web app
3. Execute as: Me
4. Who has access: Anyone
5. Copy the Web App URL into the CRM Settings or Vercel env variable.
