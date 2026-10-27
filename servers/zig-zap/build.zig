const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const zap = b.dependency("zap", .{ .target = target, .optimize = optimize, .openssl = false });
    const pg = b.dependency("pg", .{ .target = target, .optimize = optimize });

    const exe = b.addExecutable(.{
        .name = "server",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "zap", .module = zap.module("zap") },
                .{ .name = "pg", .module = pg.module("pg") },
            },
        }),
    });
    b.installArtifact(exe);

    // Zap links facil.io as a shared library; install it next to the server so the image can ship it.
    for (zap.module("zap").link_objects.items) |obj| switch (obj) {
        .other_step => |lib| b.installArtifact(lib),
        else => {},
    };
}
