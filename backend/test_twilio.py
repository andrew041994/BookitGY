from pathlib import Path
import os

import pytest
from dotenv import load_dotenv, find_dotenv
from twilio.rest import Client

# Load backend/.env explicitly to ensure credentials are available when running
# tests from any working directory, then fall back to the nearest .env.
BACKEND_DOTENV = Path(__file__).resolve().parent / ".env"
load_dotenv(BACKEND_DOTENV, override=False)
load_dotenv(find_dotenv(), override=False)

sid = os.getenv("TWILIO_ACCOUNT_SID")
token = os.getenv("TWILIO_AUTH_TOKEN")
from_number = os.getenv("TWILIO_WHATSAPP_FROM")

if not (sid and token and from_number):
    pytest.skip("Twilio credentials not configured", allow_module_level=True)

print("SID set? ", bool(sid))
print("FROM: ", from_number)

client = Client(sid, token)

msg = client.messages.create(
    from_=from_number,
    to="whatsapp:+16467161183",  # <- your sandbox-joined number here
    body="Test WhatsApp from BookitGY backend"
)

print("Message SID:", msg.sid)
