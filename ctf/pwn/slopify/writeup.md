# Slopify (pwn)
## Challenge Info
**Points**: 250  
**Difficulty**: Easy  
**Flag**: `encryptid{ch0mp_541d_7h3_p1g30n_45_h3_g4v3_y0u_7h3_fl4g}`

## Writeup
The program gives us a bunch of menu options to place and manage orders. The main vulnerability is an **Out Of Bounds** read & write in the "View Order Summary", "View Order Details", and "Edit Order" endpoints. There is only enough space for 8 orders on the stack, but these endpoints don't check if the order index provided is more or less than 8. For example:

```C
...

} else if (choice == 4) {
    printf("Enter Order ID: ");
    if (scanf("%d", &input) != 1) {
        puts("Input error");
        exit(1);
    }
    getchar();
    printf("Enter new details: ");
    fgets(orders[input].details, 80, stdin);

}

...
```

Here, even if the Order ID is a negative number or more than 8, it doesn't matter, because there are no checks to verify it. Further, there is a win function in place, which directly spawns a shell for us:

```C
void secret() {
    puts("HMMMM...");
    system("/bin/sh");
    return;
}
```

You can check out the exploit [here](./solve.py).