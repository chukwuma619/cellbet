cur_dir := $(dir $(abspath $(firstword $(MAKEFILE_LIST))))
CRATE_TOP := $(cur_dir)
ROOT := $(abspath $(CRATE_TOP)/../..)

CUSTOM_RUSTFLAGS := -C debug-assertions
FULL_RUSTFLAGS := -C target-feature=+zba,+zbb,+zbc,+zbs,-a $(CUSTOM_RUSTFLAGS)
CARGO_ARGS :=
MODE := release
CLANG := $(shell $(ROOT)/scripts/find_clang)
AR := $(subst clang,llvm-ar,$(CLANG))
OBJCOPY := $(subst clang,llvm-objcopy,$(CLANG))
BINARIES := crash-round-anchor

ifeq (release,$(MODE))
	MODE_ARGS := --release
endif

OUT_DIR := $(ROOT)/build/$(MODE)

default: build

build:
	RUSTFLAGS="$(FULL_RUSTFLAGS)" TARGET_CC="$(CLANG)" TARGET_AR="$(AR)" \
		cargo build --target=riscv64imac-unknown-none-elf $(MODE_ARGS) $(CARGO_ARGS) \
		--manifest-path $(CRATE_TOP)/Cargo.toml \
		--target-dir $(CRATE_TOP)/target
	@set -eu; \
	mkdir -p "$(OUT_DIR)"; \
	for binary in $(BINARIES); do \
		echo "Copying $$binary -> $(OUT_DIR)/"; \
		cp "$(CRATE_TOP)/target/riscv64imac-unknown-none-elf/$(MODE)/$$binary" "$(OUT_DIR)/$$binary"; \
		cp "$(OUT_DIR)/$$binary" "$(OUT_DIR)/$$binary.debug"; \
		$(OBJCOPY) --strip-debug --strip-all "$(OUT_DIR)/$$binary"; \
	done

test:
	cargo test $(CARGO_ARGS) --manifest-path $(CRATE_TOP)/Cargo.toml

check:
	cargo check --manifest-path $(CRATE_TOP)/Cargo.toml

clippy:
	cargo clippy $(CARGO_ARGS) --manifest-path $(CRATE_TOP)/Cargo.toml

fmt:
	cargo fmt --manifest-path $(CRATE_TOP)/Cargo.toml

clean:
	cargo clean --manifest-path $(CRATE_TOP)/Cargo.toml

prepare:
	rustup target add riscv64imac-unknown-none-elf

.PHONY: build test check clippy fmt clean prepare default
