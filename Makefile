.PHONY: install uninstall

NODE := $(shell command -v node)
SERVICE := $(HOME)/.config/systemd/user/mei.service
COMMAND := $(HOME)/.local/bin/mei

define SERVICE_FILE
[Unit]
Description=mei personal assistant daemon

[Service]
WorkingDirectory=$(CURDIR)
ExecStart=$(NODE) daemon/main.ts
Environment="PATH=$(PATH)"
Restart=on-failure

[Install]
WantedBy=default.target
endef

define COMMAND_FILE
#!/bin/sh
exec "$(NODE)" "$(CURDIR)/daemon/cli.ts" "$$@"
endef

export SERVICE_FILE
export COMMAND_FILE

install:
	@test -n "$(NODE)" || { echo "node is not on your PATH" >&2; exit 1; }
	@command -v git >/dev/null || { echo "git is not on your PATH" >&2; exit 1; }
	@command -v pi-bolt >/dev/null || { echo "pi-bolt is not on your PATH" >&2; exit 1; }
	npm install
	mkdir -p $(dir $(SERVICE)) $(dir $(COMMAND))
	printf '%s\n' "$$SERVICE_FILE" > $(SERVICE)
	printf '%s\n' "$$COMMAND_FILE" > $(COMMAND)
	chmod +x $(COMMAND)
	systemctl --user daemon-reload
	systemctl --user enable mei
	systemctl --user restart mei

uninstall:
	-systemctl --user disable --now mei
	rm -f $(SERVICE) $(COMMAND)
	-systemctl --user daemon-reload
