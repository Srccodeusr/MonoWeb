# MonoPanel VPS: one-line hint at login until Pterodactyl is installed. Interactive shells only.
case $- in *i*) ;; *) return 0 2>/dev/null || exit 0 ;; esac
if [ -x /usr/local/bin/ptreodoctyl-install ] && [ ! -f /var/www/pterodactyl/.env ] && [ ! -f /etc/pterodactyl/config.yml ]; then
  printf '\n  MonoPanel VPS System: type \033[1mptreodoctyl-install\033[0m to install the Pterodactyl Panel and/or Wings.\n\n'
fi
