# Eco Screen Google Calendar Webhook Setup

This CRM syncs appointments to Google Calendar through a Google Apps Script Web App URL.

## Vercel Environment Variable

Add this in Vercel Project Settings -> Environment Variables:

```text
NEXT_PUBLIC_GOOGLE_CALENDAR_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

You can also paste the same URL inside CRM Settings -> Google Calendar Webhook URL.

## Required Webhook Actions

The CRM sends:

- `action: "upsert"` when an appointment is created or updated.
- `action: "delete"` when an appointment is cancelled.
- `action: "pull"` when the user clicks Sync Google Calendar.

Important: if `googleEventId` is included, the script must update or delete that existing event. Only create a new event when `googleEventId` is empty or the old event cannot be found.

## Google Apps Script Code

Create a Google Apps Script project and paste this code:

```javascript
const CALENDAR_ID = "primary";

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || "{}");
    if (payload.action === "pull") return json({ appointments: [] });
    if (payload.action === "delete") return deleteAppointment(payload.appointment || {});
    return upsertAppointment(payload.appointment || {});
  } catch (error) {
    return json({ status: "error", error: error.message || String(error) });
  }
}

function appointmentValue(appointment, camelKey, snakeKey) {
  return appointment[camelKey] || appointment[snakeKey] || "";
}

function appointmentTimes(appointment) {
  const date = appointmentValue(appointment, "appointmentDate", "appointment_date");
  const time = appointmentValue(appointment, "appointmentTime", "appointment_time") || "09:00";
  const start = new Date(`${date}T${time}:00+08:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

function findEvent(calendar, eventId) {
  if (!eventId) return null;
  try {
    return calendar.getEventById(eventId);
  } catch (error) {
    return null;
  }
}

function upsertAppointment(appointment) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const customerName = appointmentValue(appointment, "customerName", "customer_name") || "Customer";
  const title = `[Site Measurement] ${customerName}`;
  const phone = appointment.phone || "";
  const address = appointment.address || "";
  const product = appointment.product || "";
  const assignedStaff = appointmentValue(appointment, "assignedStaff", "assigned_staff");
  const remarks = appointment.remarks || "";
  const description = [customerName, phone, address, product, assignedStaff, remarks].filter(Boolean).join("\n");
  const { start, end } = appointmentTimes(appointment);

  let event = findEvent(calendar, appointment.googleEventId);

  if (event) {
    event.setTitle(title);
    event.setTime(start, end);
    event.setDescription(description);
    event.setLocation(address);
  } else {
    event = calendar.createEvent(title, start, end, {
      description,
      location: address
    });
  }

  return json({
    status: "Synced",
    eventId: event.getId(),
    eventLink: `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(event.getId())}`
  });
}

function deleteAppointment(appointment) {
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  const event = findEvent(calendar, appointment.googleEventId);

  if (event) {
    event.deleteEvent();
  }

  return json({
    status: "Synced",
    eventId: appointment.googleEventId || "",
    eventLink: ""
  });
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Deploy

1. Click Deploy -> New deployment.
2. Type: Web app.
3. Execute as: Me.
4. Who has access: Anyone.
5. Copy the Web App URL into Vercel Environment Variables or CRM Settings.

After updating the script, create a test appointment, edit it, then cancel it. The same Google event should be updated and then deleted, not duplicated.
