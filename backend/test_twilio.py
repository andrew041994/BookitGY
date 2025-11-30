from dotenv import load_dotenv, find_dotenv
import os
from twilio.rest import Client

# Load the same .env the app uses
load_dotenv(find_dotenv(), override=False)

sid = os.getenv("TWILIO_ACCOUNT_SID")
token = os.getenv("TWILIO_AUTH_TOKEN")
from_number = os.getenv("TWILIO_WHATSAPP_FROM")

print("SID set? ", bool(sid))
print("FROM: ", from_number)

client = Client(sid, token)

msg = client.messages.create(
    from_=from_number,
    to="whatsapp:+16467161183",  # <- your sandbox-joined number here
    body="Test WhatsApp from BookitGY backend"
)

print("Message SID:", msg.sid)
