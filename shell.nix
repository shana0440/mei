let
  dotfiles = builtins.getFlake "github:shana0440/dotfiles";
  system = builtins.currentSystem;
  pkgs = dotfiles.inputs.nixpkgs.legacyPackages.${system};
in
pkgs.mkShell {
  packages = [
    pkgs.nodejs_24
    dotfiles.packages.${system}.pi-bolt
  ];
}
