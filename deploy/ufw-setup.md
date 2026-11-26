# UFW setup

Replace `<YOUR_IP>` with the public IP you will use to open the admin.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow from <YOUR_IP> to any port 8080 proto tcp
ufw enable
ufw status verbose
```

- SSH (22) must stay reachable so you can recover if your public IP changes.
- If the IP changes, update the rule over SSH:
  `ufw delete allow from <OLD_IP> to any port 8080 proto tcp`
  `ufw allow from <NEW_IP> to any port 8080 proto tcp`
- The admin uses HTTP; only use it from a trusted network. See the design doc for
  the documented risk and the HTTPS/Tailscale upgrade paths.
