def sum(left: Int32, *, right: Int32 = 0) -> Int32:
    return left + right


struct Counter:
    var value: Int32

    def __init__(out self, value: Int32):
        self.value = value

    def increment(mut self, amount: Int32) -> Int32:
        self.value += amount
        return self.value
