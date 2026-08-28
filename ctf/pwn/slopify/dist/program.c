#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

typedef struct {
    char* details;
    int order_id;
    int quantity;
} Order;

void menu() {
    puts("\n1. Place an order");
    puts("2. View Order Summary");
    puts("3. View Order Details");
    puts("4. Edit Order");
}

void banner() {
    puts("  _____ _      ____  _____ _____ ________     ___ _ _ ");
    puts(" / ____| |    / __ \\|  __ \\_   _|  ____\\ \\   / / | | |");
    puts("| (___ | |   | |  | | |__) || | | |__   \\ \\_/ /| | | |");
    puts(" \\___ \\| |   | |  | |  ___/ | | |  __|   \\   / | | | |");
    puts(" ____) | |___| |__| | |    _| |_| |       | |  |_|_|_|");
    puts("|_____/|______\\____/|_|   |_____|_|       |_|  (_|_|_)");
    return;
}

void secret() {
    puts("HMMMM...");
    system("/bin/sh");
    return;
}

int main() {
    int choice;
    Order orders[8];
    int pins[8];
    int current_order = 0;
    int input = 0;
    for (int i = 0; i < 8; i++) {
        orders[i].details = (char *)0x0;
        orders[i].order_id = i;
        orders[i].quantity = 0;
        pins[i] = 0;
    }
    banner();
    while (1) {
        menu();
        printf("-> ");
        if (scanf("%d", &choice) != 1) {
            puts("Invalid choice.");
            exit(0);
        }
        getchar();
        if (choice == 1) {
            if (current_order >= 8) {
                puts("Maximum orders reached!");
                continue;
            }
            orders[current_order].details = (char*)malloc(100);
            if (orders[current_order].details == (char*)0x0) {
                puts("Memory error");
                exit(1);
            }
            printf("Enter quantity: ");
            if (scanf("%d", &orders[current_order].quantity) != 1) {
                puts("Input error");
                exit(1);
            }
            getchar();
            printf("Create a PIN for your order: ");
            if (scanf("%d", &pins[current_order]) != 1) {
                puts("Input error");
                exit(1);
            }
            getchar();
            printf("Enter order details: ");
            fgets(orders[current_order].details, 80, stdin);
            puts("Order placed successfully!");
            current_order += 1;

        } else if (choice == 2) {
            printf("Enter Order ID: ");
            if (scanf("%d", &input) != 1) {
                puts("Input error");
                exit(1);
            }
            getchar();
            printf("Order ID: %d\n", orders[input].order_id);
            printf("Quantity: %d\n", orders[input].quantity);

        } else if (choice == 3) {
            printf("Enter Order ID: ");
            if (scanf("%d", &input) != 1) {
                puts("Input error");
                exit(1);
            }
            getchar();
            if (input >= 8) {
                puts("Invalid Order ID");
                continue;
            }
            printf("Details: ");
            if (orders[input].details == (char*)0x0) {
                puts("Order does not exist!");
                continue;
            }
            puts(orders[input].details);

        } else if (choice == 4) {
            printf("Enter Order ID: ");
            if (scanf("%d", &input) != 1) {
                puts("Input error");
                exit(1);
            }
            getchar();
            printf("Enter new details: ");
            fgets(orders[input].details, 80, stdin);

        } else {
            puts("Invalid choice!");
        }
    }
}
