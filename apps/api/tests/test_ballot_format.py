import pytest

from secvote.domain import ballot as fmt


def test_spec_vectors() -> None:
    assert fmt.encode_open([1, 0])[:8].hex() == "0100020100000000"
    assert fmt.encode_open([fmt.NOTA, fmt.ABSTAIN])[:8].hex() == "010002feff000000"
    assert len(fmt.encode_open([0])) == 64


def test_round_trip() -> None:
    b = fmt.encode_open([2, 1, fmt.ABSTAIN])
    assert fmt.decode_open(b, [3, 2, 4], allow_nota=False) == [2, 1, fmt.ABSTAIN]


@pytest.mark.parametrize(
    "mutate,error",
    [
        (lambda b: b[:63], "bad length"),
        (lambda b: b"\x02" + b[1:], "bad header"),
        (lambda b: b[:2] + b"\x01" + b[3:], "bad race count"),
        (lambda b: b[:63] + b"\x01", "non-canonical"),
    ],
)
def test_rejects_malformed(mutate, error) -> None:  # type: ignore[no-untyped-def]
    b = fmt.encode_open([0, 0])
    with pytest.raises(fmt.BallotFormatError, match=error):
        fmt.decode_open(mutate(b), [3, 2], allow_nota=True)


def test_nota_only_when_allowed() -> None:
    b = fmt.encode_open([fmt.NOTA, 0])
    assert fmt.decode_open(b, [3, 2], allow_nota=True)[0] == fmt.NOTA
    with pytest.raises(fmt.BallotFormatError):
        fmt.decode_open(b, [3, 2], allow_nota=False)


def test_choice_out_of_range() -> None:
    with pytest.raises(fmt.BallotFormatError):
        fmt.decode_open(fmt.encode_open([3, 0]), [3, 2], allow_nota=True)


def test_message_is_keccak_of_ballot() -> None:
    from eth_utils import keccak

    b = fmt.encode_open([1, 1])
    assert fmt.message_for(b) == int.from_bytes(keccak(b), "big")
