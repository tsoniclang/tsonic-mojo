from std.memory import Pointer

struct View:
    var value: Int32
    def read[origin: Origin](self: Pointer[Self, origin]) -> Int32:
        return self[].value

def main():
    pass
